package com.meganet.ampmobile;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Log;
import com.longbridge.nsh.NshHostReply;
import com.longbridge.nsh.NshView;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Crash alerts: a background check, about every 15 minutes, of the servers the user turned
 * alerts on for, with a notification when an instance that was running stops, fails or
 * restarts with no one behind it (AMP's activity log shows no person or schedule acting on
 * it since the last check). A failed startup always alerts.
 *
 * The check runs while the app is closed, so it holds each watched server's session itself,
 * sealed with a key-store key of its own that works without the user (the PIN vault can't be
 * opened in the background). The app hands it every fresh token, and takes it back on sign-out,
 * on "stay signed in" being turned off, and when the saved sign-ins are erased.
 *
 * Host calls (`crashWatch.*`): status, requestPermission, openSettings, set, token, remove, clear.
 * A pressed alert reaches the app as the event `crashWatch.open` ({serverId, shardId, title}).
 */
final class CrashWatch {
    private static final String TAG = "AMP Mobile";
    private static final String PREFS = "amp.watch";
    private static final String SERVERS = "servers";
    private static final String ASKED = "askedPermission";
    private static final String KEY_ALIAS = "amp.watch.v1";
    private static final String TRANSFORM = "AES/GCM/NoPadding";

    static final int PERIODIC_JOB = 4101;
    static final int NOW_JOB = 4102;
    private static final int PERMISSION_REQUEST = 4103;
    private static final long PERIOD_MS = 15 * 60_000L;
    /** The session is renewed when it has less than this left. */
    private static final long RENEW_WITHIN_MS = 24 * 3600_000L;
    /** The activity log is read from a little before the last check, for clocks that disagree. */
    private static final long SKEW_MS = 5 * 60_000L;
    private static final int TIMEOUT_MS = 20_000;
    private static final int MAX_BODY = 4 * 1024 * 1024;

    private static final String CHANNEL_CRASH = "crash";
    private static final String CHANNEL_ACCOUNT = "account";
    static final String EXTRA_SERVER = "amp.crash.server";
    static final String EXTRA_SHARD = "amp.crash.shard";
    static final String EXTRA_TITLE = "amp.crash.title";

    /** AMP's ApplicationState values the check reads. */
    private static final int STOPPED = 0;
    private static final int RUNNING_NOT_READY = 20;
    private static final int RUNNING_READY = 25;
    private static final int FAILED_STARTUP = 300;

    /** Guards the stored list: the app's calls and the job both read and write it. */
    private static final Object LOCK = new Object();
    /** One check at a time, so the periodic job and a "now" job never alert twice. */
    private static final AtomicBoolean CHECKING = new AtomicBoolean(false);

    private CrashWatch() {}

    // ---- The app's calls ----------------------------------------------------------------------

    /** Answers the TSX app's `crashWatch.*` calls; one per screen. */
    static final class Host {
        private final Activity activity;
        private final ExecutorService worker = Executors.newSingleThreadExecutor();
        /** The permission prompt's caller, while it's open. UI thread only. */
        private NshHostReply asking;

        Host(Activity activity) {
            this.activity = activity;
        }

        void register(NshView view) {
            view.handle("crashWatch.status", (data, reply) -> work(reply, () -> reply.resolve(status(activity))));
            view.handle("crashWatch.requestPermission", (data, reply) -> requestPermission(reply));
            view.handle("crashWatch.openSettings", (data, reply) -> {
                openSettings();
                reply.resolve(true);
            });
            view.handle("crashWatch.set", (data, reply) -> {
                Map<String, Object> a = args(data);
                work(reply, () -> {
                    try {
                        set(activity, text(a, "serverId"), text(a, "url"), text(a, "name"), text(a, "token"), text(a, "expiration"));
                        reply.resolve(true);
                    } catch (Exception e) {
                        reply.reject("error: " + e.getMessage());
                    }
                });
            });
            view.handle("crashWatch.token", (data, reply) -> {
                Map<String, Object> a = args(data);
                work(reply, () -> {
                    try {
                        reply.resolve(handOver(activity, text(a, "serverId"), text(a, "token"), text(a, "expiration")));
                    } catch (Exception e) {
                        reply.reject("error: " + e.getMessage());
                    }
                });
            });
            view.handle("crashWatch.remove", (data, reply) -> {
                String id = text(args(data), "serverId");
                work(reply, () -> reply.resolve(remove(activity, id)));
            });
            view.handle("crashWatch.clear", (data, reply) -> work(reply, () -> {
                clear(activity);
                reply.resolve(true);
            }));
        }

        void close() {
            if (asking != null) asking.resolve(permission(activity));
            asking = null;
            worker.shutdown();
        }

        private void work(NshHostReply reply, Runnable task) {
            try {
                worker.execute(task);
            } catch (java.util.concurrent.RejectedExecutionException e) {
                reply.reject("cancel: the app closed");
            }
        }

        private void requestPermission(NshHostReply reply) {
            String now = permission(activity);
            if (!"default".equals(now) || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                reply.resolve(now);
                return;
            }
            if (asking != null) {
                reply.reject("busy: already asking");
                return;
            }
            asking = reply;
            prefs(activity).edit().putBoolean(ASKED, true).apply();
            activity.requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST);
        }

        /** From the activity's onRequestPermissionsResult. */
        void onPermissionResult(int requestCode) {
            if (requestCode != PERMISSION_REQUEST || asking == null) return;
            NshHostReply reply = asking;
            asking = null;
            reply.resolve(permission(activity));
        }

        private void openSettings() {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
            try {
                activity.startActivity(intent);
            } catch (Exception e) {
                activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        android.net.Uri.fromParts("package", activity.getPackageName(), null)));
            }
        }
    }

    /** "granted", "denied" (only the phone's settings change it) or "default" (not asked yet). */
    static String permission(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        boolean enabled = nm != null && nm.areNotificationsEnabled();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return prefs(c).getBoolean(ASKED, false) ? "denied" : "default";
        }
        return enabled ? "granted" : "denied";
    }

    private static Map<String, Object> status(Context c) {
        Map<String, Object> out = new HashMap<>();
        out.put("permission", permission(c));
        List<String> watched = new ArrayList<>();
        List<String> paused = new ArrayList<>();
        synchronized (LOCK) {
            JSONObject all = load(c);
            for (Iterator<String> it = all.keys(); it.hasNext(); ) {
                String id = it.next();
                watched.add(id);
                JSONObject e = all.optJSONObject(id);
                if (e != null && e.optBoolean("paused")) paused.add(id);
            }
        }
        out.put("watched", watched);
        out.put("paused", paused);
        return out;
    }

    /** Turns alerts on for a server, or updates its address, name and session. */
    static void set(Context c, String id, String url, String name, String token, String expiration) throws Exception {
        if (id == null || url == null || token == null || expiration == null) throw new IllegalArgumentException("serverId, url, token and expiration are needed");
        if (!url.startsWith("https://") && !url.startsWith("http://")) throw new IllegalArgumentException("not a web address");
        String sealed = seal(token);
        // Scheduled first: if the phone refuses the job, nothing is kept.
        schedule(c, false);
        synchronized (LOCK) {
            JSONObject all = load(c);
            JSONObject e = all.optJSONObject(id);
            // A new address is another panel: what was seen on the old one means nothing there.
            if (e == null || !url.equals(e.optString("url"))) {
                e = new JSONObject();
                e.put("url", url);
            }
            e.put("name", name == null || name.isEmpty() ? url : name);
            e.put("token", sealed);
            e.put("exp", expiration);
            e.put("paused", false);
            all.put(id, e);
            save(c, all);
        }
        schedule(c, true);
    }

    /** A fresh token for a watched server (a sign-in, a renewal, an unlock). False when it isn't watched. */
    static boolean handOver(Context c, String id, String token, String expiration) throws Exception {
        if (id == null || token == null || expiration == null) return false;
        synchronized (LOCK) {
            if (load(c).optJSONObject(id) == null) return false;
        }
        String sealed = seal(token);
        boolean wasPaused;
        synchronized (LOCK) {
            JSONObject all = load(c);
            JSONObject e = all.optJSONObject(id);
            if (e == null) return false;
            // The very token AMP refused (an unlock restoring a dead session): stay paused, no new notice.
            if (e.optBoolean("paused") && fingerprint(token).equals(e.optString("refused"))) return true;
            wasPaused = e.optBoolean("paused");
            e.put("token", sealed);
            e.put("exp", expiration);
            e.put("paused", false);
            save(c, all);
        }
        if (wasPaused) schedule(c, true);
        return true;
    }

    static boolean remove(Context c, String id) {
        if (id == null) return false;
        boolean empty;
        synchronized (LOCK) {
            JSONObject all = load(c);
            if (all.remove(id) == null) return false;
            save(c, all);
            empty = all.length() == 0;
        }
        if (empty) unschedule(c);
        return true;
    }

    static void clear(Context c) {
        synchronized (LOCK) {
            prefs(c).edit().remove(SERVERS).apply();
        }
        unschedule(c);
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            ks.deleteEntry(KEY_ALIAS);
        } catch (Exception e) {
            Log.w(TAG, "crash alerts: key not deleted: " + e.getMessage());
        }
    }

    // ---- Scheduling -----------------------------------------------------------------------------

    /** Makes sure the periodic check is set (force-stopping the app clears it); `now` adds one soon. */
    static void schedule(Context c, boolean now) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null) return;
        ComponentName job = new ComponentName(c, CrashWatchJob.class);
        if (js.getPendingJob(PERIODIC_JOB) == null) {
            js.schedule(new JobInfo.Builder(PERIODIC_JOB, job)
                    .setPeriodic(PERIOD_MS)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true)
                    .build());
        }
        if (now) {
            js.schedule(new JobInfo.Builder(NOW_JOB, job).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).build());
        }
    }

    /** On launch: the periodic check again, if any server is watched. */
    static void resume(Context c) {
        boolean any;
        synchronized (LOCK) {
            any = load(c).length() > 0;
        }
        if (any) schedule(c, false);
    }

    private static void unschedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null) return;
        js.cancel(PERIODIC_JOB);
        js.cancel(NOW_JOB);
    }

    // ---- The check ------------------------------------------------------------------------------

    /** Checks every watched server once. Run by CrashWatchJob, off the main thread. */
    static void checkAll(Context c) {
        if (!CHECKING.compareAndSet(false, true)) return;
        try {
            List<String> ids = new ArrayList<>();
            synchronized (LOCK) {
                for (Iterator<String> it = load(c).keys(); it.hasNext(); ) ids.add(it.next());
            }
            for (String id : ids) {
                try {
                    checkServer(c, id);
                } catch (Exception e) {
                    Log.w(TAG, "crash alerts: check failed: " + e.getClass().getSimpleName());
                }
            }
        } finally {
            CHECKING.set(false);
        }
    }

    private enum Kind { FAILED, STOPPED, RESTARTED }

    private static final class Alert {
        final String shardId;
        final String shardName;
        final Kind kind;
        final String error;
        /** Whether a person or schedule acted on it: null when the activity log can't be read. */
        Boolean intended;

        Alert(String shardId, String shardName, Kind kind, String error) {
            this.shardId = shardId;
            this.shardName = shardName;
            this.kind = kind;
            this.error = error;
        }
    }

    private static void checkServer(Context c, String id) throws Exception {
        JSONObject entry;
        synchronized (LOCK) {
            entry = load(c).optJSONObject(id);
        }
        if (entry == null || entry.optBoolean("paused")) return;
        String url = entry.optString("url");
        String name = entry.optString("name", url);
        String sealedToken = entry.optString("token");
        String token;
        try {
            token = open(sealedToken);
        } catch (Exception e) {
            // The key was lost (a restore, a reset): the app hands a new token on its next unlock.
            pause(c, id, sealedToken, name, "");
            return;
        }
        long since = entry.optLong("last", 0);
        long startedAt = System.currentTimeMillis();
        String renewedToken = null;
        String renewedExp = null;

        if (dueForRenewal(entry.optString("exp"))) {
            JSONObject fresh = renew(url, token);
            if (fresh != null) {
                token = renewedToken = fresh.getString("token");
                renewedExp = fresh.getString("expiration");
            }
        }

        Response list = get(url, "/api/Shards", token);
        if (list.code == 401 && renewedToken == null) {
            JSONObject fresh = renew(url, token);
            if (fresh != null) {
                token = renewedToken = fresh.getString("token");
                renewedExp = fresh.getString("expiration");
                list = get(url, "/api/Shards", token);
            }
        }
        if (list.code == 401) {
            pause(c, id, sealedToken, name, fingerprint(token));
            return;
        }
        if (list.code != 200) return; // Offline or the panel is down: try again next time.
        JSONArray shards = list.array();
        if (shards == null) return;

        JSONObject before = entry.optJSONObject("shards");
        JSONObject after = new JSONObject();
        List<Alert> alerts = new ArrayList<>();
        for (int i = 0; i < shards.length(); i++) {
            JSONObject shard = shards.optJSONObject(i);
            String shardId = shard == null ? null : shard.optString("id", null);
            if (shardId == null || shardId.isEmpty() || shard.optBoolean("deleted")) continue;
            String shardName = firstText(shard, "displayName", "name");
            if (shardName == null) shardName = "An instance";
            JSONObject seen = before == null ? null : before.optJSONObject(shardId);
            Response state = get(url, "/api/Shards/" + enc(shardId) + "/state", token);
            JSONObject s = state.code == 200 ? state.object() : null;
            if (s == null) {
                if (seen != null) after.put(shardId, seen); // Unknown this time: keep what was last seen.
                continue;
            }
            int status = s.optInt("status", -1);
            String launched = s.isNull("startedAt") ? "" : s.optString("startedAt", "");
            JSONObject now = new JSONObject().put("s", status).put("t", launched);
            after.put(shardId, now);
            if (seen == null) continue; // First sight: nothing to compare with.
            Kind kind = judge(seen.optInt("s", -1), seen.optString("t", ""), status, launched);
            if (kind != null) alerts.add(new Alert(shardId, shardName, kind, s.isNull("lastErrorMessage") ? null : s.optString("lastErrorMessage", null)));
        }

        long from = Math.max(0, since - SKEW_MS);
        for (Alert a : alerts) {
            if (a.kind != Kind.FAILED) a.intended = someoneActed(url, token, a.shardId, from);
        }

        synchronized (LOCK) {
            JSONObject all = load(c);
            JSONObject current = all.optJSONObject(id);
            if (current == null || !url.equals(current.optString("url"))) return; // Removed or moved meanwhile.
            current.put("shards", after);
            current.put("last", startedAt);
            // A token the app handed over meanwhile is newer than this renewal's.
            if (renewedToken != null && sealedToken.equals(current.optString("token"))) {
                current.put("token", seal(renewedToken));
                current.put("exp", renewedExp);
            }
            save(c, all);
        }

        for (Alert a : alerts) {
            if (Boolean.TRUE.equals(a.intended)) continue;
            notifyCrash(c, id, name, a);
        }
    }

    /**
     * What a change from one check to the next means: a startup that failed, a stop or a
     * restart from a running state (judged later against the activity log), or nothing.
     * A stop seen half way ("Stopping", "Preparing to sleep") is someone's stop, not a crash.
     */
    private static Kind judge(int was, String wasLaunched, int is, String launched) {
        if (is == FAILED_STARTUP && was != FAILED_STARTUP) return Kind.FAILED;
        boolean wasUp = was == RUNNING_NOT_READY || was == RUNNING_READY || (was > STOPPED && was < RUNNING_NOT_READY);
        if (!wasUp) return null;
        if (is == STOPPED) return Kind.STOPPED;
        boolean isUp = is == RUNNING_NOT_READY || is == RUNNING_READY || (is > STOPPED && is < RUNNING_NOT_READY);
        if (isUp && (was == RUNNING_READY || was == RUNNING_NOT_READY) && !launched.isEmpty() && !launched.equals(wasLaunched)) return Kind.RESTARTED;
        return null;
    }

    /** Whether a person or a schedule acted on the instance since `fromMs`; null when the log can't be read. */
    private static Boolean someoneActed(String url, String token, String shardId, long fromMs) {
        try {
            String query = "/api/Audit?targetId=" + enc(shardId) + "&from=" + enc(Instant.ofEpochMilli(fromMs).toString()) + "&pageSize=100";
            Response r = get(url, query, token);
            if (r.code != 200) return null;
            JSONObject page = r.object();
            JSONArray items = page == null ? null : page.optJSONArray("items");
            if (items == null) return null;
            for (int i = 0; i < items.length(); i++) {
                JSONObject e = items.optJSONObject(i);
                // AuditOrigin: 0 is the system on its own; anything else has a person or a schedule behind it.
                if (e != null && e.optInt("origin", 0) != 0) return true;
            }
            return false;
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean dueForRenewal(String expiration) {
        try {
            return Instant.parse(expiration).toEpochMilli() - System.currentTimeMillis() < RENEW_WITHIN_MS;
        } catch (Exception e) {
            return true;
        }
    }

    /** `POST /api/Auth/renew`: the same session with a fresh token, or null. */
    private static JSONObject renew(String url, String token) {
        try {
            Response r = request(url, "/api/Auth/renew", "POST", token);
            JSONObject o = r.code == 200 ? r.object() : null;
            if (o == null || !(o.opt("token") instanceof String) || !(o.opt("expiration") instanceof String)) return null;
            Instant.parse(o.getString("expiration"));
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    /** AMP refused the session: alerts for it stop until the app hands over a new one. */
    private static void pause(Context c, String id, String sealedToken, String name, String refused) throws JSONException {
        synchronized (LOCK) {
            JSONObject all = load(c);
            JSONObject e = all.optJSONObject(id);
            // A token handed over since this check began may still be good.
            if (e == null || e.optBoolean("paused") || !sealedToken.equals(e.optString("token"))) return;
            e.put("paused", true);
            e.put("refused", refused);
            save(c, all);
        }
        notifyPaused(c, id, name);
    }

    // ---- Notifications --------------------------------------------------------------------------

    private static void notifyCrash(Context c, String serverId, String serverName, Alert a) {
        String title;
        String body;
        switch (a.kind) {
            case FAILED:
                title = a.shardName + " failed to start";
                body = a.error != null && !a.error.isEmpty() ? a.error : "AMP couldn't start it.";
                break;
            case RESTARTED:
                title = a.shardName + " restarted on its own";
                body = "It may have crashed. AMP started it again.";
                break;
            default:
                title = a.shardName + " stopped unexpectedly";
                body = a.error != null && !a.error.isEmpty()
                        ? a.error
                        : a.intended == null ? "AMP didn't say why, and this account can't read the activity log." : "No one stopped it.";
        }
        Notification.Builder b = builder(c, CHANNEL_CRASH, title, serverName + ": " + body)
                .setContentIntent(opener(c, serverId, a.shardId, a.shardName))
                .setCategory(Notification.CATEGORY_ERROR)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPublicVersion(builder(c, CHANNEL_CRASH, "An instance stopped", "Unlock to see which.").build());
        post(c, (serverId + "/" + a.shardId).hashCode(), b.build());
    }

    private static void notifyPaused(Context c, String serverId, String serverName) {
        Notification.Builder b = builder(c, CHANNEL_ACCOUNT, "Crash alerts paused for " + serverName,
                "AMP ended the session. Open AMP Mobile and sign in to turn them back on.")
                .setContentIntent(opener(c, serverId, null, null));
        post(c, ("paused/" + serverId).hashCode(), b.build());
    }

    private static Notification.Builder builder(Context c, String channel, String title, String body) {
        channels(c);
        return new Notification.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_stat_crash)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setShowWhen(true);
    }

    private static PendingIntent opener(Context c, String serverId, String shardId, String title) {
        Intent intent = new Intent(c, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_SERVER, serverId);
        if (shardId != null) intent.putExtra(EXTRA_SHARD, shardId);
        if (title != null) intent.putExtra(EXTRA_TITLE, title);
        int code = (serverId + "/" + shardId).hashCode();
        return PendingIntent.getActivity(c, code, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static void post(Context c, int id, Notification n) {
        if (!"granted".equals(permission(c))) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(id, n);
    }

    private static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel crash = new NotificationChannel(CHANNEL_CRASH, "Crash alerts", NotificationManager.IMPORTANCE_HIGH);
        crash.setDescription("An instance stopped, failed or restarted with no one behind it.");
        nm.createNotificationChannel(crash);
        NotificationChannel account = new NotificationChannel(CHANNEL_ACCOUNT, "Sign-in needed", NotificationManager.IMPORTANCE_DEFAULT);
        account.setDescription("Crash alerts for a server stopped because AMP ended the session.");
        nm.createNotificationChannel(account);
    }

    // ---- HTTP -----------------------------------------------------------------------------------

    private static final class Response {
        final int code;
        final String body;

        Response(int code, String body) {
            this.code = code;
            this.body = body;
        }

        JSONObject object() {
            try {
                return new JSONObject(body);
            } catch (Exception e) {
                return null;
            }
        }

        JSONArray array() {
            try {
                return new JSONArray(body);
            } catch (Exception e) {
                return null;
            }
        }
    }

    private static Response get(String base, String path, String token) throws IOException {
        return request(base, path, "GET", token);
    }

    /** One request with the session's token. Redirects aren't followed, so the token never reaches another host. */
    private static Response request(String base, String path, String method, String token) throws IOException {
        String root = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        HttpURLConnection conn = (HttpURLConnection) new URL(root + path).openConnection();
        try {
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", "application/json");
            conn.setUseCaches(false);
            if ("POST".equals(method)) {
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(0);
                try (OutputStream out = conn.getOutputStream()) {
                    out.flush();
                }
            }
            int code = conn.getResponseCode();
            if (code != 200) return new Response(code, "");
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[16 * 1024];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    if (buf.size() + n > MAX_BODY) throw new IOException("answer too large");
                    buf.write(chunk, 0, n);
                }
                return new Response(code, buf.toString(StandardCharsets.UTF_8.name()));
            }
        } finally {
            conn.disconnect();
        }
    }

    // ---- Storage and the key ------------------------------------------------------------------

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The watched servers. Call with LOCK held. */
    private static JSONObject load(Context c) {
        try {
            return new JSONObject(prefs(c).getString(SERVERS, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    /** Call with LOCK held. */
    private static void save(Context c, JSONObject all) {
        prefs(c).edit().putString(SERVERS, all.toString()).commit();
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return gen.generateKey();
    }

    private static String seal(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        synchronized (CrashWatch.class) {
            cipher.init(Cipher.ENCRYPT_MODE, key());
        }
        byte[] out = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        Base64.Encoder b64 = Base64.getEncoder();
        return b64.encodeToString(cipher.getIV()) + ":" + b64.encodeToString(out);
    }

    private static String open(String sealed) throws Exception {
        int colon = sealed.indexOf(':');
        if (colon < 0) throw new IllegalArgumentException("not sealed");
        Base64.Decoder b64 = Base64.getDecoder();
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
        if (!(entry instanceof KeyStore.SecretKeyEntry)) throw new IllegalStateException("no key");
        cipher.init(Cipher.DECRYPT_MODE, ((KeyStore.SecretKeyEntry) entry).getSecretKey(), new GCMParameterSpec(128, b64.decode(sealed.substring(0, colon))));
        return new String(cipher.doFinal(b64.decode(sealed.substring(colon + 1))), StandardCharsets.UTF_8);
    }

    // ---- Small helpers --------------------------------------------------------------------------

    /** A token's SHA-256, to know it again without keeping it. */
    private static String fingerprint(String token) {
        try {
            byte[] d = java.security.MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(d);
        } catch (Exception e) {
            return "";
        }
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return s;
        }
    }

    private static String firstText(JSONObject o, String... keys) {
        for (String k : keys) {
            if (!o.isNull(k)) {
                String v = o.optString(k, "").trim();
                if (!v.isEmpty()) return v;
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> args(Object data) {
        if (data instanceof Map) return (Map<String, Object>) data;
        if (data instanceof JSONObject) {
            Map<String, Object> out = new HashMap<>();
            JSONObject o = (JSONObject) data;
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String k = it.next();
                out.put(k, o.opt(k));
            }
            return out;
        }
        if (data instanceof String) {
            try {
                return args(new JSONObject((String) data));
            } catch (JSONException e) {
                return new HashMap<>();
            }
        }
        return new HashMap<>();
    }

    private static String text(Map<String, Object> a, String key) {
        Object v = a.get(key);
        return v instanceof String ? (String) v : null;
    }
}
