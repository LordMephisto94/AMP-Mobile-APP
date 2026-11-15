package com.meganet.ampmobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import com.longbridge.nsh.NshView;
import com.longbridge.nsh.StandaloneHost;
import java.util.Map;
import org.json.JSONObject;

/**
 * Runs the TSX app (assets/nsh) full screen, as NSH's packaged AppActivity did, and answers
 * its calls for the phone's key store and fingerprint prompt (DeviceKeys) and for blocking
 * screenshots (FLAG_SECURE, the Security page's "Block screenshots").
 */
public final class MainActivity extends Activity {
    /** Where "Block screenshots" is kept, so it applies before the app's first frame. */
    private static final String PREFS = "amp.screen";
    private static final String SECURE = "secure";

    private NshView view;
    private DeviceKeys keys;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        StandaloneHost.edgeToEdge(this);
        // Before anything is drawn: the lock screen and the app switcher's snapshot are covered too.
        applySecure(prefs().getBoolean(SECURE, false));
        view = new NshView(this);
        StandaloneHost.useStandaloneLimits(view);
        view.setErrorListener(message -> Log.e("AMP Mobile", message));
        keys = new DeviceKeys(this);
        keys.register(view);
        view.handle("screen.secure.get", (data, reply) -> reply.resolve(prefs().getBoolean(SECURE, false)));
        view.handle("screen.secure.set", (data, reply) -> {
            boolean on = Boolean.TRUE.equals(arg(data, "on"));
            prefs().edit().putBoolean(SECURE, on).apply();
            applySecure(on);
            reply.resolve(on);
        });
        setContentView(view);
        view.handleNotificationIntent(getIntent());
        if (state == null) view.handleUrlSchemeIntent(getIntent());
        view.loadAssetBundle("nsh");
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** FLAG_SECURE: no screenshots or screen recording, and a blank app-switcher snapshot. */
    private void applySecure(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    private static Object arg(Object data, String name) {
        if (data instanceof Map) return ((Map<?, ?>) data).get(name);
        if (data instanceof JSONObject) return ((JSONObject) data).opt(name);
        return null;
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
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (view == null || !view.handleBack()) super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (keys != null) keys.close();
        if (view != null) view.destroy();
        super.onDestroy();
    }
}
