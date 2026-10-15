package app.rouse.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Receives every AlarmManager alarm (exported=false, directBootAware): FIRE, SNOOZE_END, SAFETY,
 * WAKE_CHECK, WAKE_DEADLINE, TEST, DEFERRED_START, BEDTIME. goAsync() keeps the broadcast (and
 * with it the alarm-clock FGS-start allowance) alive until RingEngine has handled it.
 */
public final class AlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        final String action = intent.getAction();
        if (action == null || !action.startsWith("app.rouse.alarm.action.")) return;
        final long fireAt = intent.getLongExtra(RouseConstants.EXTRA_FIRE_AT, 0L);
        final PendingResult pending = goAsync();
        RingEngine.get(context).post(() -> {
            try {
                RingEngine.get(context).onAlarm(action, fireAt);
            } finally {
                pending.finish();
            }
        });
    }
}
