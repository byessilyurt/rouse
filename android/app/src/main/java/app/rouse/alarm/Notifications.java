package app.rouse.alarm;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.os.UserManagerCompat;
import app.rouse.alarm.model.Episode;
import java.util.Date;

/** Notification channels (plan §3.3) and every notification Rouse posts. */
public final class Notifications {

    private Notifications() {}

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) createChannels(context);
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.O)
    private static void createChannels(Context context) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel ring = new NotificationChannel(RouseConstants.CHANNEL_RING, "Ringing alarms", NotificationManager.IMPORTANCE_HIGH);
        ring.setDescription("Shown while an alarm rings. The sound comes from the alarm itself.");
        ring.setSound(null, null);
        ring.enableVibration(false);
        ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ring);

        NotificationChannel wake = new NotificationChannel(RouseConstants.CHANNEL_WAKE_CHECK, "Wake-up check", NotificationManager.IMPORTANCE_HIGH);
        wake.setDescription("\"Are you awake?\" after an alarm is dismissed.");
        wake.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(wake);

        NotificationChannel bedtime = new NotificationChannel(RouseConstants.CHANNEL_BEDTIME, "Bedtime reminder", NotificationManager.IMPORTANCE_DEFAULT);
        bedtime.setDescription("Reminds you to go to bed for your sleep goal.");
        nm.createNotificationChannel(bedtime);

        NotificationChannel status = new NotificationChannel(RouseConstants.CHANNEL_STATUS, "Alarm status", NotificationManager.IMPORTANCE_LOW);
        status.setDescription("For example \"Snoozed until 07:10\".");
        nm.createNotificationChannel(status);
    }

    // ── PendingIntents ──

    static PendingIntent ringUiIntent(Context context, Episode e) {
        boolean locked = !UserManagerCompat.isUserUnlocked(context);
        Intent i;
        if (locked || e.nativeFallbackShown) {
            // Before first unlock the WebView cannot start (credential storage is locked).
            i = new Intent(context, FallbackMissionActivity.class);
            i.putExtra(RouseConstants.EXTRA_SESSION_ID, e.sessionId);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        } else {
            i = new Intent(context, MainActivity.class);
            i.putExtra(RouseConstants.EXTRA_RING_SESSION, e.sessionId);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        }
        return PendingIntent.getActivity(
            context,
            RouseConstants.RC_RING_UI,
            i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    static PendingIntent openAppIntent(Context context) {
        Intent i = new Intent(context, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context,
            RouseConstants.RC_OPEN_APP,
            i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    static String title(Episode e) {
        if (e.isTest) return "Test alarm";
        String label = e.alarm == null ? "" : e.alarm.label;
        return label == null || label.trim().isEmpty() ? "Alarm" : label.trim();
    }

    static String formatTime(Context context, long epochMs) {
        return android.text.format.DateFormat.getTimeFormat(context).format(new Date(epochMs));
    }

    /** The ringing FGS notification: CATEGORY_ALARM, full-screen intent, ongoing, NO actions. */
    public static Notification buildRing(Context context, Episode e) {
        PendingIntent ui = ringUiIntent(context, e);
        return new NotificationCompat.Builder(context, RouseConstants.CHANNEL_RING)
            .setSmallIcon(R.drawable.ic_stat_rouse)
            .setContentTitle(title(e))
            .setContentText(e.nativeFallbackShown ? "Solve the problems to stop the alarm" : "Tap to open your mission")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(ui)
            .setFullScreenIntent(ui, true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    public static void postWakeCheck(Context context, Episode e) {
        Intent ui = new Intent(context, MainActivity.class);
        ui.putExtra(RouseConstants.EXTRA_WAKE_CHECK_SESSION, e.sessionId);
        ui.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent uiPi = PendingIntent.getActivity(
            context,
            RouseConstants.RC_WAKE_CHECK_UI,
            ui,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent confirm = new Intent(context, WakeCheckReceiver.class);
        confirm.setAction(RouseConstants.ACTION_CONFIRM_AWAKE);
        confirm.putExtra(RouseConstants.EXTRA_SESSION_ID, e.sessionId);
        PendingIntent confirmPi = PendingIntent.getBroadcast(
            context,
            RouseConstants.RC_CONFIRM_AWAKE,
            confirm,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String text = e.wakeCheckDeadlineAt == null
            ? "Confirm you're up, or the alarm rings again."
            : "Confirm by " + formatTime(context, e.wakeCheckDeadlineAt) + ", or the alarm rings again.";

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, RouseConstants.CHANNEL_WAKE_CHECK)
            .setSmallIcon(R.drawable.ic_stat_rouse)
            .setContentTitle("Are you awake?")
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(uiPi)
            .addAction(R.drawable.ic_stat_rouse, "I'm awake", confirmPi);
        if (UserManagerCompat.isUserUnlocked(context)) {
            b.setFullScreenIntent(uiPi, true);
        }
        post(context, RouseConstants.NOTIF_WAKE_CHECK, b.build());
    }

    public static void postSnoozed(Context context, Episode e) {
        if (e.snoozeUntil == null) return;
        Notification n = new NotificationCompat.Builder(context, RouseConstants.CHANNEL_STATUS)
            .setSmallIcon(R.drawable.ic_stat_rouse)
            .setContentTitle("Snoozed until " + formatTime(context, e.snoozeUntil))
            .setContentText(title(e))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(openAppIntent(context))
            .build();
        post(context, RouseConstants.NOTIF_STATUS, n);
    }

    public static void postBedtime(Context context, Long nextFireAt) {
        String text = nextFireAt == null
            ? "Time to wind down for your sleep goal."
            : "Your alarm rings at " + formatTime(context, nextFireAt) + ". Time to wind down.";
        Notification n = new NotificationCompat.Builder(context, RouseConstants.CHANNEL_BEDTIME)
            .setSmallIcon(R.drawable.ic_stat_rouse)
            .setContentTitle("Bedtime")
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))
            .build();
        post(context, RouseConstants.NOTIF_BEDTIME, n);
    }

    public static boolean canPost(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    public static void post(Context context, int id, Notification n) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            DiagLog.w("notif", "POST_NOTIFICATIONS not granted; notification " + id + " not shown");
            return;
        }
        try {
            ensureChannels(context);
            nm.notify(id, n);
        } catch (SecurityException e) {
            DiagLog.e("notif", "notify refused id=" + id, e);
        }
    }

    public static void cancel(Context context, int id) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(id);
    }
}
