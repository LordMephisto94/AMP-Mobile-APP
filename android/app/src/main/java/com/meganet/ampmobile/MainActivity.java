package com.meganet.ampmobile;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Log;
import com.longbridge.nsh.NshView;
import com.longbridge.nsh.StandaloneHost;

/**
 * Runs the TSX app (assets/nsh) full screen, as NSH's packaged AppActivity did, and answers
 * its calls for the phone's key store and fingerprint prompt (DeviceKeys).
 */
public final class MainActivity extends Activity {
    private NshView view;
    private DeviceKeys keys;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        StandaloneHost.edgeToEdge(this);
        view = new NshView(this);
        StandaloneHost.useStandaloneLimits(view);
        view.setErrorListener(message -> Log.e("AMP Mobile", message));
        keys = new DeviceKeys(this);
        keys.register(view);
        setContentView(view);
        view.handleNotificationIntent(getIntent());
        if (state == null) view.handleUrlSchemeIntent(getIntent());
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
