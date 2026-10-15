package app.rouse.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * System broadcasts (exported, directBootAware): boot (incl. LOCKED_BOOT_COMPLETED, before first
 * unlock), app update, time / time-zone change and exact-alarm permission change → reconcile.
 * Never starts the ring service directly (D-020); RingEngine defers via setAlarmClock(now + 5 s).
 */
public final class SystemEventReceiver extends BroadcastReceiver {

    static final String ACTION_LOCKED_BOOT_COMPLETED = "android.intent.action.LOCKED_BOOT_COMPLETED";
    static final String ACTION_EXACT_ALARM_PERMISSION_CHANGED =
        "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!isHandled(action)) return;
        final PendingResult pending = goAsync();
        final RingEngine engine = RingEngine.get(context);
        final String reason = action.substring(action.lastIndexOf('.') + 1);
        engine.reconcile(reason);
        // Same single-threaded queue: this runs after reconcile has finished.
        engine.post(pending::finish);
    }

    static boolean isHandled(String action) {
        if (action == null) return false;
        switch (action) {
            case Intent.ACTION_BOOT_COMPLETED:
            case ACTION_LOCKED_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
            case Intent.ACTION_TIME_CHANGED:
            case Intent.ACTION_TIMEZONE_CHANGED:
            case ACTION_EXACT_ALARM_PERMISSION_CHANGED:
                return true;
            default:
                return false;
        }
    }
}
