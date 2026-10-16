package app.rouse.alarm;

/**
 * Java copies of the constants tagged [JAVA] in src/core/defaults.ts, plus native-only identifiers.
 * ConstantsParityTest parses defaults.ts and fails if a [JAVA] value here drifts.
 */
public final class RouseConstants {

    private RouseConstants() {}

    // ── [JAVA] constants mirrored from src/core/defaults.ts (names must match exactly) ──
    public static final int NATIVE_MIRROR_VERSION = 1;
    public static final long NATIVE_UI_READY_TIMEOUT_MS = 10_000L;
    public static final long SAFETY_RERING_INTERVAL_MS = 60_000L;
    public static final long MAX_SILENCE_LEASE_MS = 60_000L;
    public static final long MISSED_GRACE_MS = 30L * 60_000L;
    public static final long DEFERRED_START_DELAY_MS = 5_000L;
    public static final int WAKE_CHECK_MAX_RERINGS = 2;
    public static final long CALL_MODE_CAP_MS = 10L * 60_000L;
    public static final int NATIVE_FALLBACK_PROBLEMS = 5;
    public static final int NATIVE_LOG_CAP = 500;
    public static final long MAX_CUSTOM_SOUND_BYTES = 20L * 1024L * 1024L;
    public static final String BACKUP_SOUND_ID = "classic";

    /** BUNDLED_SOUNDS order, ids, names and loop lengths (parity-tested). */
    public static final String[] BUNDLED_SOUND_IDS = {"classic", "pulse", "siren", "chime", "buzzer", "rise"};
    public static final String[] BUNDLED_SOUND_NAMES = {"Classic beep", "Pulse", "Siren", "Chime", "Buzzer", "Rise"};
    public static final long[] BUNDLED_SOUND_LOOP_MS = {1200L, 500L, 1000L, 1200L, 800L, 2000L};

    // ── Native-only timing ──
    /** Preview auto-stop (RousePlugin.previewSound contract). */
    public static final long PREVIEW_MAX_MS = 15_000L;
    /** If the player is not playing this long after start, switch to the backup tone. */
    public static final long NO_PLAYBACK_CHECK_MS = 3_000L;
    /** Volume ramp start level in dB (ramps dB-linearly to 0 dB). */
    public static final double RAMP_START_DB = -30.0;
    /** Wakelock timeout; refreshed by every safety tick while ringing. */
    public static final long WAKELOCK_TIMEOUT_MS = 10L * 60_000L;
    /** Bedtime reminder only if the next fire is at most this far away. */
    public static final long BEDTIME_HORIZON_MS = 24L * 60L * 60_000L;
    public static final int DIAG_LOG_LINES = 200;

    // ── Fixed PendingIntent request codes (D-013) ──
    public static final int RC_MAIN = 1;
    public static final int RC_SNOOZE = 2;
    public static final int RC_SAFETY = 3;
    public static final int RC_WAKE_CHECK = 4;
    public static final int RC_WAKE_DEADLINE = 5;
    public static final int RC_TEST = 6;
    public static final int RC_DEFERRED_START = 7;
    public static final int RC_BEDTIME = 8;
    /** Activity / notification PendingIntents (not alarms). */
    public static final int RC_SHOW_APP = 100;
    public static final int RC_RING_UI = 101;
    public static final int RC_WAKE_CHECK_UI = 102;
    public static final int RC_CONFIRM_AWAKE = 103;
    public static final int RC_OPEN_APP = 104;

    // ── AlarmReceiver actions (one action per request code, so PendingIntents never collide) ──
    public static final String ACTION_FIRE = "app.rouse.alarm.action.FIRE";
    public static final String ACTION_SNOOZE_END = "app.rouse.alarm.action.SNOOZE_END";
    public static final String ACTION_SAFETY = "app.rouse.alarm.action.SAFETY";
    public static final String ACTION_WAKE_CHECK = "app.rouse.alarm.action.WAKE_CHECK";
    public static final String ACTION_WAKE_DEADLINE = "app.rouse.alarm.action.WAKE_DEADLINE";
    public static final String ACTION_TEST = "app.rouse.alarm.action.TEST";
    public static final String ACTION_DEFERRED_START = "app.rouse.alarm.action.DEFERRED_START";
    public static final String ACTION_BEDTIME = "app.rouse.alarm.action.BEDTIME";
    public static final String ACTION_CONFIRM_AWAKE = "app.rouse.alarm.action.CONFIRM_AWAKE";
    public static final String ACTION_RING = "app.rouse.alarm.action.RING";

    // ── Intent extras ──
    public static final String EXTRA_FIRE_AT = "app.rouse.alarm.extra.FIRE_AT";
    public static final String EXTRA_ALARM_IDS = "app.rouse.alarm.extra.ALARM_IDS";
    public static final String EXTRA_RING_SESSION = "app.rouse.alarm.extra.RING_SESSION";
    public static final String EXTRA_WAKE_CHECK_SESSION = "app.rouse.alarm.extra.WAKE_CHECK_SESSION";
    public static final String EXTRA_SESSION_ID = "app.rouse.alarm.extra.SESSION_ID";

    // ── Notification channels (plan §3.3) and ids ──
    public static final String CHANNEL_RING = "ring";
    public static final String CHANNEL_WAKE_CHECK = "wake_check";
    public static final String CHANNEL_BEDTIME = "bedtime";
    public static final String CHANNEL_STATUS = "status";
    public static final int NOTIF_RING = 1001;
    public static final int NOTIF_WAKE_CHECK = 1002;
    public static final int NOTIF_BEDTIME = 1003;
    public static final int NOTIF_STATUS = 1004;

    // ── Storage ──
    public static final String PREFS_NAME = "rouse_native";
    public static final String DIAG_PREFS_NAME = "rouse_diag";
}
