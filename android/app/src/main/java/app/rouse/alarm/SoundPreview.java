package app.rouse.alarm;

import android.content.Context;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;

/**
 * previewSound / stopPreview: plays on USAGE_ALARM at `volume`% of STREAM_ALARM (restored
 * afterwards) and auto-stops after PREVIEW_MAX_MS. Main thread only.
 */
final class SoundPreview {

    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = this::stop;
    private AlarmPlayer player;
    private int savedVolume = -1;

    SoundPreview(Context context) {
        this.context = context.getApplicationContext() != null ? context.getApplicationContext() : context;
    }

    void start(SoundLibrary.Source source, int volumePercent) {
        stop();
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio != null) {
            try {
                savedVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM);
                int max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                audio.setStreamVolume(AudioManager.STREAM_ALARM, VolumeLock.indexFor(volumePercent, max), 0);
            } catch (SecurityException e) {
                DiagLog.w("preview", "volume change refused");
            }
        }
        player = new AlarmPlayer(context);
        player.start(source, 0, false);
        handler.postDelayed(autoStop, RouseConstants.PREVIEW_MAX_MS);
    }

    void stop() {
        handler.removeCallbacks(autoStop);
        if (player != null) {
            player.stop();
            player = null;
        }
        if (savedVolume >= 0) {
            AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audio != null) {
                try {
                    audio.setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0);
                } catch (SecurityException e) {
                    DiagLog.w("preview", "volume restore refused");
                }
            }
            savedVolume = -1;
        }
    }
}
