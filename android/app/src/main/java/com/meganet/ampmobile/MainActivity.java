package com.meganet.ampmobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Log;
import java.util.HashMap;
import java.util.Map;
import com.longbridge.nsh.NshView;
import com.longbridge.nsh.StandaloneHost;

/**
 * Runs the TSX app (assets/nsh) full screen, as NSH's packaged AppActivity did, and answers
 * its calls for the phone's key store and fingerprint prompt (DeviceKeys) and for crash alerts
 * (CrashWatch).
 */
public final class MainActivity extends Activity {
    /** Where unreleased test builds kept "Block screenshots" (FLAG_SECURE); cleared, as screenshots are always allowed. */
    private static final String OLD_SCREEN_PREFS = "amp.screen";

    private NshView view;
    private DeviceKeys keys;
    private CrashWatch.Host crashWatch;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        StandaloneHost.edgeToEdge(this);
        getSharedPreferences(OLD_SCREEN_PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        view = new NshView(this);
        StandaloneHost.useStandaloneLimits(view);
        view.setErrorListener(message -> Log.e("AMP Mobile", message));
        keys = new DeviceKeys(this);
        keys.register(view);
        crashWatch = new CrashWatch.Host(this);
        crashWatch.register(view);
        CrashWatch.resume(this);
        setContentView(view);
        view.handleNotificationIntent(getIntent());
        if (state == null) {
            view.handleUrlSchemeIntent(getIntent());
            openAlert(getIntent());
        }
        view.loadAssetBundle("nsh");
    }

    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        StandaloneHost.systemBars(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (view != null) {
            view.handleNotificationIntent(intent);
            view.handleUrlSchemeIntent(intent);
            openAlert(intent);
        }
    }

    /** A pressed crash alert: the app opens that instance once it's unlocked. */
    private void openAlert(Intent intent) {
        String server = intent == null ? null : intent.getStringExtra(CrashWatch.EXTRA_SERVER);
        if (server == null) return;
        Map<String, Object> target = new HashMap<>();
        target.put("serverId", server);
        String shard = intent.getStringExtra(CrashWatch.EXTRA_SHARD);
        if (shard != null) target.put("shardId", shard);
        String title = intent.getStringExtra(CrashWatch.EXTRA_TITLE);
        if (title != null) target.put("title", title);
        view.send("crashWatch.open", target);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (crashWatch != null) crashWatch.onPermissionResult(requestCode);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (view == null || !view.handleBack()) super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (keys != null) keys.close();
        if (crashWatch != null) crashWatch.close();
        if (view != null) view.destroy();
        super.onDestroy();
    }
}
