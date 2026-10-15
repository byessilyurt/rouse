package app.rouse.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import java.util.List;

/**
 * AlarmManager wrapper (D-013, D-019, D-020). Every alarm uses a FIXED request code and its own
 * action, so re-scheduling replaces the previous PendingIntent and nothing leaks. All
 * PendingIntents are explicit and FLAG_IMMUTABLE. Everything except the bedtime reminder uses
 * setAlarmClock (exact, wakes from Doze, exempt from standby buckets, allows FGS start).
 */
public final class AlarmScheduler {

    private final Context context;
    private final AlarmManager alarmManager;

    public AlarmScheduler(Context context) {
        this.context = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        this.alarmManager = (AlarmManager) this.context.getSystemService(Context.ALARM_SERVICE);
    }

    static String actionFor(int requestCode) {
        switch (requestCode) {
            case RouseConstants.RC_MAIN:
                return RouseConstants.ACTION_FIRE;
            case RouseConstants.RC_SNOOZE:
                return RouseConstants.ACTION_SNOOZE_END;
            case RouseConstants.RC_SAFETY:
                return RouseConstants.ACTION_SAFETY;
            case RouseConstants.RC_WAKE_CHECK:
                return RouseConstants.ACTION_WAKE_CHECK;
            case RouseConstants.RC_WAKE_DEADLINE:
                return RouseConstants.ACTION_WAKE_DEADLINE;
            case RouseConstants.RC_TEST:
                return RouseConstants.ACTION_TEST;
            case RouseConstants.RC_DEFERRED_START:
                return RouseConstants.ACTION_DEFERRED_START;
            case RouseConstants.RC_BEDTIME:
                return RouseConstants.ACTION_BEDTIME;
            default:
                throw new IllegalArgumentException("unknown request code " + requestCode);
        }
    }

    private Intent receiverIntent(int requestCode) {
        Intent i = new Intent(context, AlarmReceiver.class);
        i.setAction(actionFor(requestCode));
        return i;
    }

    private PendingIntent broadcastPi(Intent intent, int requestCode) {
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private PendingIntent showAppPi() {
        Intent i = new Intent(context, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context,
            RouseConstants.RC_SHOW_APP,
            i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /** True if exact alarms can be scheduled (always true below API 31). */
    public boolean canScheduleExact() {
        if (alarmManager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return alarmManager.canScheduleExactAlarms();
        }
        return true;
    }

    /** The main alarm: one PendingIntent for the earliest NextFire. */
    public void scheduleMain(long fireAt, List<String> alarmIds) {
        Intent i = receiverIntent(RouseConstants.RC_MAIN);
        i.putExtra(RouseConstants.EXTRA_FIRE_AT, fireAt);
        i.putExtra(RouseConstants.EXTRA_ALARM_IDS, alarmIds.toArray(new String[0]));
        setAlarmClock(RouseConstants.RC_MAIN, fireAt, broadcastPi(i, RouseConstants.RC_MAIN));
    }

    /** Any other alarm-clock alarm (snooze, safety, wake check, deadline, test, deferred start). */
    public void schedule(int requestCode, long at) {
        Intent i = receiverIntent(requestCode);
        i.putExtra(RouseConstants.EXTRA_FIRE_AT, at);
        setAlarmClock(requestCode, at, broadcastPi(i, requestCode));
    }

    /** Bedtime reminder: exact-and-allow-while-idle (it is a notification, not an alarm). */
    public void scheduleBedtime(long at) {
        Intent i = receiverIntent(RouseConstants.RC_BEDTIME);
        i.putExtra(RouseConstants.EXTRA_FIRE_AT, at);
        PendingIntent pi = broadcastPi(i, RouseConstants.RC_BEDTIME);
        if (alarmManager == null) return;
        try {
            if (canScheduleExact()) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException e) {
            DiagLog.e("sched", "bedtime exact alarm refused", e);
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    public void cancel(int requestCode) {
        if (alarmManager == null) return;
        PendingIntent pi = PendingIntent.getBroadcast(
            context,
            requestCode,
            receiverIntent(requestCode),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pi == null) return;
        alarmManager.cancel(pi);
        pi.cancel();
    }

    private void setAlarmClock(int requestCode, long at, PendingIntent pi) {
        if (alarmManager == null) {
            DiagLog.w("sched", "no AlarmManager");
            return;
        }
        try {
            if (canScheduleExact()) {
                alarmManager.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showAppPi()), pi);
                DiagLog.i("sched", "rc=" + requestCode + " at=" + at);
            } else {
                // Exact alarms revoked (API 31–32 without permission): best effort, flagged on the health screen.
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                DiagLog.w("sched", "exact alarms not allowed; inexact rc=" + requestCode);
            }
        } catch (SecurityException e) {
            DiagLog.e("sched", "setAlarmClock refused rc=" + requestCode, e);
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }
}
