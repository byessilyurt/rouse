package app.rouse.alarm;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import java.io.IOException;

/**
 * Plays the alarm sound on USAGE_ALARM, looping, with a dB-linear ramp from RAMP_START_DB to
 * 0 dB over `rampSec`. ANY failure (missing custom file, decoder error, async error, or no
 * playback RouseConstants.NO_PLAYBACK_CHECK_MS after start) switches to the bundled backup tone;
 * if even that fails, a ToneGenerator alarm tone. Main thread only.
 */
public final class AlarmPlayer {

    private static final long RAMP_STEP_MS = 200L;

    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private ToneGenerator toneGenerator;
    private boolean usingBackup;
    private boolean muted;
    private boolean paused;
    private boolean stopped = true;
    private long rampStartedAt;
    private long rampMs;
    private float currentGain = 1f;

    private final Runnable rampTick = new Runnable() {
        @Override
        public void run() {
            applyGain();
            if (!stopped && rampMs > 0 && SystemClock.elapsedRealtime() - rampStartedAt < rampMs) {
                handler.postDelayed(this, RAMP_STEP_MS);
            }
        }
    };

    private final Runnable playbackCheck = new Runnable() {
        @Override
        public void run() {
            if (stopped || paused) return;
            boolean playing = false;
            try {
                playing = player != null && player.isPlaying();
            } catch (IllegalStateException ignored) {
                playing = false;
            }
            if (!playing && toneGenerator == null) {
                DiagLog.w("player", "no playback after " + RouseConstants.NO_PLAYBACK_CHECK_MS + " ms; backup tone");
                switchToBackup();
            }
        }
    };

    public AlarmPlayer(Context context) {
        this.context = context.getApplicationContext() != null ? context.getApplicationContext() : context;
    }

    /** Start playing `source` (null → backup tone). rampSec 0 = full volume immediately. */
    public void start(SoundLibrary.Source source, int rampSec, boolean startPaused) {
        stopInternal();
        stopped = false;
        muted = false;
        paused = startPaused;
        usingBackup = false;
        rampMs = Math.max(0, rampSec) * 1000L;
        rampStartedAt = SystemClock.elapsedRealtime();
        SoundLibrary.Source s = source;
        if (s == null) {
            DiagLog.w("player", "sound unavailable; backup tone");
            s = SoundLibrary.backup();
            usingBackup = true;
        }
        if (!open(s)) {
            switchToBackup();
            return;
        }
        afterOpen();
    }

    private void afterOpen() {
        applyGain();
        if (!paused) {
            try {
                player.start();
            } catch (IllegalStateException e) {
                DiagLog.e("player", "start failed", e);
                switchToBackup();
                return;
            }
        }
        handler.removeCallbacks(rampTick);
        if (rampMs > 0) handler.postDelayed(rampTick, RAMP_STEP_MS);
        handler.removeCallbacks(playbackCheck);
        handler.postDelayed(playbackCheck, RouseConstants.NO_PLAYBACK_CHECK_MS);
    }

    private boolean open(SoundLibrary.Source s) {
        MediaPlayer mp = new MediaPlayer();
        try {
            mp.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
            if (s.file != null) {
                mp.setDataSource(s.file.getAbsolutePath());
            } else {
                AssetFileDescriptor afd = context.getResources().openRawResourceFd(s.rawRes);
                if (afd == null) throw new IOException("raw resource not openable");
                try {
                    mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                } finally {
                    afd.close();
                }
            }
            mp.setLooping(true);
            mp.setWakeMode(context, PowerManager.PARTIAL_WAKE_LOCK);
            mp.setOnErrorListener((p, what, extra) -> {
                DiagLog.w("player", "MediaPlayer error what=" + what + " extra=" + extra);
                handler.post(this::switchToBackup);
                return true;
            });
            mp.prepare();
            player = mp;
            return true;
        } catch (IOException | RuntimeException e) {
            DiagLog.e("player", "open failed", e);
            mp.release();
            return false;
        }
    }

    private void switchToBackup() {
        if (stopped) return;
        releasePlayer();
        if (!usingBackup) {
            usingBackup = true;
            if (open(SoundLibrary.backup())) {
                afterOpen();
                return;
            }
        }
        startToneGenerator();
    }

    private void startToneGenerator() {
        if (toneGenerator != null) return;
        try {
            toneGenerator = new ToneGenerator(AudioManager.STREAM_ALARM, ToneGenerator.MAX_VOLUME);
            if (!paused && !muted) toneGenerator.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK);
            DiagLog.w("player", "using ToneGenerator last resort");
        } catch (RuntimeException e) {
            DiagLog.e("player", "ToneGenerator failed", e);
            toneGenerator = null;
        }
    }

    /** Gain for the dB ramp at elapsed time t (ms) over rampMs; 1.0 when done or no ramp. */
    static float rampGain(long elapsedMs, long rampMs) {
        if (rampMs <= 0 || elapsedMs >= rampMs) return 1f;
        double db = RouseConstants.RAMP_START_DB * (1.0 - (double) Math.max(0, elapsedMs) / (double) rampMs);
        return (float) Math.pow(10.0, db / 20.0);
    }

    private void applyGain() {
        if (player == null) return;
        float g = muted ? 0f : rampGain(SystemClock.elapsedRealtime() - rampStartedAt, rampMs);
        currentGain = g;
        try {
            player.setVolume(g, g);
        } catch (IllegalStateException ignored) {
            // released concurrently
        }
    }

    /** Silence lease: gain 0 (keeps playing so resuming is instant). */
    public void mute() {
        muted = true;
        applyGain();
        if (toneGenerator != null) toneGenerator.stopTone();
    }

    /** Resume at FULL target gain with no ramp (lease expiry / safety re-ring fail loud). */
    public void unmuteFull() {
        muted = false;
        rampMs = 0;
        handler.removeCallbacks(rampTick);
        applyGain();
        if (toneGenerator != null && !paused) toneGenerator.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK);
    }

    /** During a phone call: stop audio, keep state. */
    public void pauseForCall() {
        if (paused) return;
        paused = true;
        handler.removeCallbacks(playbackCheck);
        try {
            if (player != null && player.isPlaying()) player.pause();
        } catch (IllegalStateException ignored) {
            // ignore
        }
        if (toneGenerator != null) toneGenerator.stopTone();
    }

    public void resumeAfterCall() {
        if (!paused) return;
        paused = false;
        try {
            if (player != null) player.start();
        } catch (IllegalStateException e) {
            switchToBackup();
            return;
        }
        if (toneGenerator != null && !muted) toneGenerator.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK);
        handler.removeCallbacks(playbackCheck);
        handler.postDelayed(playbackCheck, RouseConstants.NO_PLAYBACK_CHECK_MS);
    }

    public boolean isMuted() {
        return muted;
    }

    public float currentGain() {
        return currentGain;
    }

    public void stop() {
        stopInternal();
    }

    private void stopInternal() {
        stopped = true;
        handler.removeCallbacks(rampTick);
        handler.removeCallbacks(playbackCheck);
        releasePlayer();
        if (toneGenerator != null) {
            try {
                toneGenerator.stopTone();
                toneGenerator.release();
            } catch (RuntimeException ignored) {
                // ignore
            }
            toneGenerator = null;
        }
    }

    private void releasePlayer() {
        if (player == null) return;
        try {
            player.setOnErrorListener(null);
            if (player.isPlaying()) player.stop();
        } catch (IllegalStateException ignored) {
            // ignore
        }
        player.release();
        player = null;
    }
}
