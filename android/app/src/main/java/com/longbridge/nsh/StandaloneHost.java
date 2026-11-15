package com.longbridge.nsh;

import android.app.Activity;

/**
 * Sets an NshView up as NSH's own packaged app does (AppActivity, which is final): edge to
 * edge, the app's system bar colors and the limits of an app of its own rather than an
 * embedded module. Those helpers are package-private in the runtime, hence this class in
 * its package. Checked against NSH 0.5.0: check it again when updating the runtime.
 */
public final class StandaloneHost {
    private StandaloneHost() {}

    public static void edgeToEdge(Activity activity) {
        DevActivity.edgeToEdge(activity);
    }

    public static void systemBars(Activity activity) {
        DevActivity.systemBars(activity);
    }

    public static void useStandaloneLimits(NshView view) {
        view.useStandaloneLimits();
    }
}
