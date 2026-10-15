package app.rouse.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** "I'm awake" action on the wake-up check notification (exported=false, directBootAware). */
public final class WakeCheckReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !RouseConstants.ACTION_CONFIRM_AWAKE.equals(intent.getAction())) return;
        final String sessionId = intent.getStringExtra(RouseConstants.EXTRA_SESSION_ID);
        final PendingResult pending = goAsync();
        final RingEngine engine = RingEngine.get(context);
        engine.post(() -> {
            try {
                engine.confirmAwake(sessionId);
            } catch (RouseError e) {
                DiagLog.w("wakecheck", "confirm ignored: " + e.code);
                Notifications.cancel(context, RouseConstants.NOTIF_WAKE_CHECK);
            } finally {
                pending.finish();
            }
        });
    }
}
