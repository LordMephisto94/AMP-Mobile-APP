package com.meganet.ampmobile;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import com.longbridge.nsh.NshView;
import com.longbridge.nsh.StandaloneHost;

/**
 * Runs the TSX app (assets/nsh) full screen, as NSH's packaged AppActivity did, and answers
 * its calls for the phone's key store and fingerprint prompt (DeviceKeys).
 */
public final class MainActivity extends Activity {
    private NshView view;
    private DeviceKeys keys;
    /** The app's "block screenshots" setting. */
    private boolean captureBlocked;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // The app switcher must not keep a picture of the servers (Android 13+; older versions
        // are covered in onPause). A user's own screenshots still work.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false);
        StandaloneHost.edgeToEdge(this);
        view = new NshView(this);
        StandaloneHost.useStandaloneLimits(view);
        // Error text from the app can carry addresses: it goes to the log only in a debuggable build.
        final boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        view.setErrorListener(message -> {
            if (debuggable) Log.e("AMP Mobile", message);
        });
        keys = new DeviceKeys(this);
        keys.register(view);
        // The app's "block screenshots" setting: screenshots, screen recording and the recents picture stay blank.
        view.handle("window.secure", (data, reply) -> {
            Object on = null;
            if (data instanceof java.util.Map) on = ((java.util.Map<?, ?>) data).get("on");
            else if (data instanceof org.json.JSONObject) on = ((org.json.JSONObject) data).opt("on");
            captureBlocked = Boolean.TRUE.equals(on);
            runOnUiThread(this::applyCaptureFlag);
            reply.resolve(true);
        });
        setContentView(view);
        // Nothing from the launching intent is passed on to NSH (no URL-scheme or notification
        // handlers): the app declares neither, and the launcher entry is open to every app.
        view.loadAssetBundle("nsh");
    }

    @Override
    protected void onPause() {
        // Before Android 13 the app switcher's picture is taken as the app leaves the front:
        // a secure window is blanked there, and made normal again in onResume.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && !captureBlocked) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    private void applyCaptureFlag() {
        if (captureBlocked) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        StandaloneHost.systemBars(this);
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
