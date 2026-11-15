package com.meganet.ampmobile;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Runs the crash alerts' check (CrashWatch) on a thread of its own when the system says. */
public final class CrashWatchJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                CrashWatch.checkAll(getApplicationContext());
            } finally {
                jobFinished(params, false);
            }
        }, "crash-alerts").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        // The check saves as it goes; the next run picks up from the last one saved.
        return false;
    }
}
