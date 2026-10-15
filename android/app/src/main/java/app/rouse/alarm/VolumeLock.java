package app.rouse.alarm;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.ContentObserver;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import app.rouse.alarm.store.NativePrefs;

/**
 * D-021: while ringing, STREAM_ALARM is forced to the alarm's volume and put back if anything
 * changes it (best effort, via a Settings.System ContentObserver); the user's original volume is
 * restored afterwards. The original is persisted ("volumeLockSaved") so a crash mid-ring still
 * restores it later (RingEngine.reconcile → restoreIfStale). Main thread only.
 */
@SuppressLint("ApplySharedPref")
public final class VolumeLock {

    private static final String KEY_SAVED = "volumeLockSaved";

    private final Context context;
    private final AudioManager audio;
    private final SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ContentObserver observer;
    private int target = -1;

    public VolumeLock(Context context) {
        this.context = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        this.audio = (AudioManager) this.context.getSystemService(Context.AUDIO_SERVICE);
        this.prefs = NativePrefs.get(this.context);
    }

    /** Stream index for `percent` (10..100) of STREAM_ALARM max, at least 1. */
    static int indexFor(int percent, int max) {
        int p = Math.max(0, Math.min(100, percent));
        int idx = Math.round(max * p / 100f);
        return Math.max(1, Math.min(max, idx));
    }

    /** Save the current volume (unless one is already saved from a previous crash), then force. */
    public void lock(int percent) {
        if (audio == null) return;
        if (!prefs.contains(KEY_SAVED)) {
            prefs.edit().putInt(KEY_SAVED, audio.getStreamVolume(AudioManager.STREAM_ALARM)).commit();
        }
        target = indexFor(percent, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM));
        enforce();
        if (observer == null) {
            observer = new ContentObserver(handler) {
                @Override
                public void onChange(boolean selfChange) {
                    enforce();
                }
            };
            try {
                context.getContentResolver().registerContentObserver(Settings.System.CONTENT_URI, true, observer);
            } catch (RuntimeException e) {
                DiagLog.e("volume", "observer registration failed", e);
                observer = null;
            }
        }
    }

    private void enforce() {
        if (audio == null || target < 0) return;
        try {
            if (audio.getStreamVolume(AudioManager.STREAM_ALARM) != target) {
                audio.setStreamVolume(AudioManager.STREAM_ALARM, target, 0);
            }
        } catch (SecurityException e) {
            DiagLog.w("volume", "setStreamVolume refused: " + e.getMessage());
        }
    }

    /** Stop enforcing and restore the saved original volume. */
    public void unlock() {
        if (observer != null) {
            try {
                context.getContentResolver().unregisterContentObserver(observer);
            } catch (RuntimeException ignored) {
                // ignore
            }
            observer = null;
        }
        target = -1;
        restoreSaved(context);
    }

    /** Restore a persisted original volume left behind by a crash. Safe to call any time no ring is active. */
    public static void restoreSaved(Context context) {
        SharedPreferences prefs = NativePrefs.get(context);
        if (!prefs.contains(KEY_SAVED)) return;
        int saved = prefs.getInt(KEY_SAVED, -1);
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio != null && saved >= 0) {
            try {
                audio.setStreamVolume(AudioManager.STREAM_ALARM, saved, 0);
            } catch (SecurityException e) {
                DiagLog.w("volume", "restore refused: " + e.getMessage());
            }
        }
        prefs.edit().remove(KEY_SAVED).commit();
    }
}
