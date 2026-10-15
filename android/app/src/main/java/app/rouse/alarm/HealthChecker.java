package app.rouse.alarm;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.media.AudioManager;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Evaluates every HealthCheckId (src/platform/AlarmBackend.ts) in enum order (plan §3.4). */
public final class HealthChecker {

    public static final String[] CHECK_IDS = {
        "exactAlarm", "notifications", "fullScreenIntent", "batteryOptimization", "backgroundRestricted",
        "dndAllowsAlarms", "alarmVolume", "camera", "motionSensors", "lockedDevice",
    };

    private final Context context;

    public HealthChecker(Context context) {
        this.context = context.getApplicationContext() != null ? context.getApplicationContext() : context;
    }

    public JSONObject evaluate() throws JSONException {
        Notifications.ensureChannels(context);
        JSONArray checks = new JSONArray();
        checks.put(exactAlarm());
        checks.put(notifications());
        checks.put(fullScreenIntent());
        checks.put(batteryOptimization());
        checks.put(backgroundRestricted());
        checks.put(dndAllowsAlarms());
        checks.put(alarmVolume());
        checks.put(camera());
        checks.put(motionSensors());
        checks.put(check("lockedDevice", "ok", "critical", "none", "Rouse rings on the lock screen, even when the app is closed."));
        JSONObject o = new JSONObject();
        o.put("platform", "android");
        o.put("sdkInt", Build.VERSION.SDK_INT);
        o.put("manufacturer", Build.MANUFACTURER == null ? JSONObject.NULL : Build.MANUFACTURER.toLowerCase(Locale.ROOT));
        o.put("checks", checks);
        o.put("checkedAt", System.currentTimeMillis());
        return o;
    }

    static JSONObject check(String id, String state, String severity, String fix, String detail) throws JSONException {
        JSONObject c = new JSONObject();
        c.put("id", id);
        c.put("state", state);
        c.put("severity", severity);
        c.put("fix", fix);
        c.put("detail", detail);
        return c;
    }

    // ── individual checks (also used by RousePlugin.requestFix) ──

    public boolean exactAlarmOk() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            return am != null && am.canScheduleExactAlarms();
        }
        return true;
    }

    private JSONObject exactAlarm() throws JSONException {
        if (exactAlarmOk()) return check("exactAlarm", "ok", "critical", "none", "Exact alarms are allowed.");
        boolean fixable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2;
        return check(
            "exactAlarm",
            "action-needed",
            "critical",
            fixable ? "open-settings" : "none",
            "Alarms & reminders permission is off, so alarms may ring late."
        );
    }

    public boolean notificationPermissionGranted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    public boolean notificationsOk() {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) {
                NotificationChannel ch = nm.getNotificationChannel(RouseConstants.CHANNEL_RING);
                if (ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
            }
        }
        return true;
    }

    private JSONObject notifications() throws JSONException {
        if (notificationsOk()) return check("notifications", "ok", "critical", "none", "Notifications are on.");
        String fix = notificationPermissionGranted() ? "open-settings" : "request-permission";
        return check(
            "notifications",
            "action-needed",
            "critical",
            fix,
            "Notifications are off, so the alarm screen can't open by itself."
        );
    }

    public boolean fullScreenIntentOk() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            return nm != null && nm.canUseFullScreenIntent();
        }
        return true;
    }

    private JSONObject fullScreenIntent() throws JSONException {
        if (fullScreenIntentOk()) return check("fullScreenIntent", "ok", "critical", "none", "The alarm can open over the lock screen.");
        return check(
            "fullScreenIntent",
            "action-needed",
            "critical",
            "open-settings",
            "Full-screen alarms are off, so the alarm only shows as a notification."
        );
    }

    public boolean batteryOk() {
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
    }

    private JSONObject batteryOptimization() throws JSONException {
        if (batteryOk()) return check("batteryOptimization", "ok", "recommended", "none", "Battery optimisation is off for Rouse.");
        return check(
            "batteryOptimization",
            "action-needed",
            "recommended",
            "open-settings",
            "Battery optimisation is on for Rouse. Some phones may delay or stop alarms."
        );
    }

    public boolean backgroundOk() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            return am == null || !am.isBackgroundRestricted();
        }
        return true;
    }

    private JSONObject backgroundRestricted() throws JSONException {
        if (backgroundOk()) return check("backgroundRestricted", "ok", "recommended", "none", "Background activity is allowed.");
        return check(
            "backgroundRestricted",
            "action-needed",
            "recommended",
            "open-settings",
            "Background activity is restricted for Rouse."
        );
    }

    /** null = unknown. */
    public Boolean dndOk() {
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return null;
            int filter = nm.getCurrentInterruptionFilter();
            if (filter == NotificationManager.INTERRUPTION_FILTER_NONE) return false;
            if (filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                NotificationManager.Policy policy = nm.getNotificationPolicy();
                if (policy == null) return null;
                return (policy.priorityCategories & NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS) != 0;
            }
            return true;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private JSONObject dndAllowsAlarms() throws JSONException {
        Boolean ok = dndOk();
        if (ok == null) return check("dndAllowsAlarms", "unknown", "recommended", "open-settings", "Couldn't read Do Not Disturb settings.");
        if (ok) return check("dndAllowsAlarms", "ok", "recommended", "none", "Do Not Disturb lets alarms through.");
        return check("dndAllowsAlarms", "action-needed", "recommended", "open-settings", "Do Not Disturb is blocking alarms.");
    }

    public boolean volumeOk() {
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        return audio == null || audio.getStreamVolume(AudioManager.STREAM_ALARM) > 0;
    }

    private JSONObject alarmVolume() throws JSONException {
        if (volumeOk()) return check("alarmVolume", "ok", "recommended", "none", "Alarm volume is on.");
        return check(
            "alarmVolume",
            "action-needed",
            "recommended",
            "open-settings",
            "Alarm volume is at zero. Rouse raises it while ringing, but check your settings."
        );
    }

    public boolean cameraGranted() {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private JSONObject camera() throws JSONException {
        if (!context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            return check("camera", "unsupported", "optional", "none", "No camera found. QR missions are unavailable.");
        }
        if (cameraGranted()) return check("camera", "ok", "optional", "none", "Camera access is allowed for QR missions.");
        return check(
            "camera",
            "action-needed",
            "optional",
            "request-permission",
            "Camera access is needed only for QR / barcode missions."
        );
    }

    public boolean hasAccelerometer() {
        SensorManager sm = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        return sm != null && sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null;
    }

    private JSONObject motionSensors() throws JSONException {
        if (hasAccelerometer()) return check("motionSensors", "ok", "optional", "none", "Motion sensor found for shake, steps and squats.");
        return check("motionSensors", "unsupported", "optional", "none", "No motion sensor. Shake, steps and squat missions are unavailable.");
    }
}
