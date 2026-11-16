package com.meganet.ampmobile;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Faster crash checks: while the user has them on, a foreground service (with its own quiet
 * notification, as Android requires) runs CrashWatch's check every 1, 2 or 5 minutes instead of
 * the background job's 15. Each run is woken by an alarm that may fire while the phone is idle;
 * Android still spaces those out when the phone has been idle a while, so the 15-minute job
 * stays on as the floor.
 */
public final class CrashWatchService extends Service {
    private static final String TAG = "AMP Mobile";
    private static final String CHANNEL = "watching";
    private static final int NOTIFICATION_ID = 4201;
    private static final int ALARM_CODE = 4202;
    /** A check gets at most this long awake; the job's own limits stop it well before. */
    private static final long WAKE_MS = 3 * 60_000L;

    private ExecutorService worker;
    /** While the phone is awake, the next check comes from here on time; the alarm covers sleep. */
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final Runnable timed = this::runCheck;
    /** When the last check started (elapsed ms): the timer and the alarm never both run one. */
    private volatile long lastCheck;

    /** Starts the service, or tells a running one its interval changed. From the app's screen only. */
    static void start(Context c) {
        Intent intent = new Intent(c, CrashWatchService.class);
        try {
            c.startForegroundService(intent);
        } catch (Exception e) {
            // Android refused (the app isn't in front, say): the 15-minute job still runs.
            Log.w(TAG, "faster checks not started: " + e.getClass().getSimpleName());
        }
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, CrashWatchService.class));
        AlarmManager alarms = c.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.cancel(alarmIntent(c));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        worker = Executors.newSingleThreadExecutor();
        running = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int minutes = CrashWatch.fastMinutes(this);
        int servers = CrashWatch.watchedCount(this);
        if (minutes <= 0 || servers == 0) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = ongoing(minutes, servers);
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(NOTIFICATION_ID, n);
        } catch (Exception e) {
            Log.w(TAG, "faster checks refused: " + e.getClass().getSimpleName());
            stopSelf();
            return START_NOT_STICKY;
        }
        // Started or told of a new interval: check now and count from here.
        lastCheck = 0;
        runCheck();
        // Restarted by Android after being killed, it picks up the setting again.
        return START_STICKY;
    }

    /** One check on the worker thread, kept awake while it runs, then the next alarm. */
    void runCheck() {
        if (worker == null || worker.isShutdown()) return;
        int minutes = CrashWatch.fastMinutes(this);
        long now = SystemClock.elapsedRealtime();
        // The other trigger already ran this round (a few seconds' grace for a timer that fires early).
        if (minutes > 0 && lastCheck > 0 && now - lastCheck < minutes * 60_000L - 5_000L) return;
        lastCheck = now;
        timer.removeCallbacks(timed);
        PowerManager power = getSystemService(PowerManager.class);
        PowerManager.WakeLock wake = power == null ? null : power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AMPMobile:crashCheck");
        if (wake != null) wake.acquire(WAKE_MS);
        try {
            worker.execute(() -> {
                try {
                    CrashWatch.checkAll(getApplicationContext());
                } finally {
                    int m = CrashWatch.fastMinutes(this);
                    if (m > 0) timer.postDelayed(timed, m * 60_000L);
                    scheduleNext(this);
                    if (wake != null && wake.isHeld()) wake.release();
                }
            });
        } catch (java.util.concurrent.RejectedExecutionException e) {
            if (wake != null && wake.isHeld()) wake.release();
        }
    }

    /** The next check, allowed while the phone is idle (Android may still delay it then). */
    static void scheduleNext(Context c) {
        int minutes = CrashWatch.fastMinutes(c);
        if (minutes <= 0) return;
        AlarmManager alarms = c.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        // A little after the timer, so while the phone is awake the timer wins and this finds the round done.
        alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + minutes * 60_000L + 20_000L, alarmIntent(c));
    }

    private static PendingIntent alarmIntent(Context c) {
        Intent intent = new Intent(c, Tick.class);
        return PendingIntent.getBroadcast(c, ALARM_CODE, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification ongoing(int minutes, int servers) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Watching servers", NotificationManager.IMPORTANCE_MIN);
            channel.setDescription("Shown while faster crash checks are on. Android requires it; you can hide it here.");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, NOTIFICATION_ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String every = minutes == 1 ? "every minute" : "every " + minutes + " minutes";
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_amp)
                .setColor(0xFF7C3AED)
                .setContentTitle("Watching for crashes")
                .setContentText(servers + (servers == 1 ? " server, " : " servers, ") + every)
                .setContentIntent(tap)
                .setOngoing(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    @Override
    public void onDestroy() {
        timer.removeCallbacks(timed);
        if (worker != null) worker.shutdownNow();
        worker = null;
        running = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** The running service, for the alarm to reach without starting a new one from the background. */
    private static volatile CrashWatchService running;

    /** The alarm: runs a check in the service if it's still there; if Android stopped it, nothing (the job remains). */
    public static final class Tick extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            CrashWatchService service = running;
            if (service != null && CrashWatch.fastMinutes(c) > 0) service.runCheck();
        }
    }

    /** After a restart of the phone: faster checks come back if they were on. */
    public static final class Boot extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
            CrashWatch.resume(c);
            if (CrashWatch.fastMinutes(c) > 0 && CrashWatch.watchedCount(c) > 0) start(c);
        }
    }
}
