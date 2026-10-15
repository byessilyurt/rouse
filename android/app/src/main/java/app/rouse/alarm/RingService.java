package app.rouse.alarm;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import app.rouse.alarm.model.Episode;

/**
 * Foreground service (type mediaPlayback, D-020) that makes the noise: ring notification with a
 * full-screen intent (no actions), AlarmPlayer on USAGE_ALARM, VolumeLock, vibration, a partial
 * wakelock and audio focus. During a phone call it only vibrates and starts the audio when the
 * call ends. Started only by RingEngine from alarm-clock receivers or the foreground activity.
 */
public final class RingService extends Service {

    private static final long CALL_POLL_MS = 2_000L;
    private static final long[] VIBRATION_PATTERN = { 0L, 800L, 600L };

    private static volatile String aliveSession;
    private static RingService instance; // main thread only

    private final Handler handler = new Handler(Looper.getMainLooper());
    private AlarmPlayer player;
    private VolumeLock volumeLock;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audio;
    private AudioFocusRequest focusRequest;
    private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> {
        // An alarm keeps ringing regardless of focus changes.
    };
    private Episode episode;
    private boolean silenced;
    private boolean vibrateEnabled;
    private boolean vibrating;
    private boolean inCall;
    private boolean foreground;

    private final Runnable callPoll = new Runnable() {
        @Override
        public void run() {
            boolean now = isInCall();
            if (now != inCall) {
                inCall = now;
                DiagLog.i("ring", inCall ? "call started: vibrate only" : "call ended: audio resumes");
                if (inCall) player.pauseForCall();
                else player.resumeAfterCall();
                updateVibration();
            }
            handler.postDelayed(this, CALL_POLL_MS);
        }
    };

    /** True if this process's service is ringing `sessionId`. */
    public static boolean isAlive(String sessionId) {
        String s = aliveSession;
        return sessionId != null && sessionId.equals(s);
    }

    /** True if this process's service is ringing any episode. */
    public static boolean isAliveAny() {
        return aliveSession != null;
    }

    /** The running instance (main thread only), or null. */
    public static RingService current() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        player = new AlarmPlayer(this);
        volumeLock = new VolumeLock(this);
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Episode e = RingEngine.get(this).snapshot();
        boolean ringing = e != null && e.isRinging();
        Notification n = ringing ? Notifications.buildRing(this, e) : placeholderNotification();
        // startForeground FIRST, before any other work (5 s rule).
        foreground = startAsForeground(n);
        if (!ringing) {
            DiagLog.w("ring", "service started without a ringing episode; stopping");
            stopSelfCompletely();
            return START_NOT_STICKY;
        }
        if (!foreground) Notifications.post(this, RouseConstants.NOTIF_RING, n);
        beginRinging(e);
        return START_NOT_STICKY;
    }

    private Notification placeholderNotification() {
        return new NotificationCompat.Builder(this, RouseConstants.CHANNEL_RING)
            .setSmallIcon(R.drawable.ic_stat_rouse)
            .setContentTitle("Rouse")
            .setContentText("Alarm")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .build();
    }

    private boolean startAsForeground(Notification n) {
        Notifications.ensureChannels(this);
        try {
            int type = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
            }
            ServiceCompat.startForeground(this, RouseConstants.NOTIF_RING, n, type);
            return true;
        } catch (RuntimeException ex) {
            DiagLog.e("ring", "startForeground failed", ex);
            return false;
        }
    }

    private void beginRinging(Episode e) {
        boolean restartSameSession = episode != null && episode.sessionId.equals(e.sessionId) && aliveSession != null;
        episode = e;
        aliveSession = e.sessionId;
        refreshWakeLock();
        requestFocus();
        volumeLock.lock(e.alarm.volume);

        SoundLibrary.Source source = new SoundLibrary(this).resolve(e.alarm.soundKind, e.alarm.soundId);
        // A safety re-ring always starts loud; so does a restart of an already-running ring.
        int ramp = Episode.SOURCE_SAFETY.equals(e.source) || restartSameSession ? 0 : e.alarm.volumeRampSec;
        inCall = isInCall();
        player.start(source, ramp, inCall);
        silenced = e.silenced;
        if (silenced) player.mute();
        vibrateEnabled = e.alarm.vibrate;
        stopVibration();
        updateVibration();
        handler.removeCallbacks(callPoll);
        handler.postDelayed(callPoll, CALL_POLL_MS);
        DiagLog.i("ring", "ringing source=" + e.source + " test=" + e.isTest + " fg=" + foreground);
    }

    /** Silence lease from RingEngine (main thread). */
    public void setSilenced(boolean value) {
        if (episode == null) return;
        silenced = value;
        if (value) player.mute();
        else player.unmuteFull();
        updateVibration();
    }

    /** Re-post the ring notification (e.g. the full-screen target switched to the native fallback). */
    public void refreshNotification() {
        Episode e = RingEngine.get(this).snapshot();
        if (e == null || !e.isRinging()) return;
        Notifications.post(this, RouseConstants.NOTIF_RING, Notifications.buildRing(this, e));
    }

    public void refreshWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm == null) return;
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rouse:ring");
                wakeLock.setReferenceCounted(false);
            }
            wakeLock.acquire(RouseConstants.WAKELOCK_TIMEOUT_MS);
        } catch (RuntimeException ex) {
            DiagLog.e("ring", "wakelock failed", ex);
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (RuntimeException ignored) {
            // ignore
        }
        wakeLock = null;
    }

    private static AudioAttributes alarmAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    @SuppressWarnings("deprecation")
    private void requestFocus() {
        if (audio == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest == null) {
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        .setAudioAttributes(alarmAttributes())
                        .setOnAudioFocusChangeListener(focusListener)
                        .build();
                }
                audio.requestAudioFocus(focusRequest);
            } else {
                audio.requestAudioFocus(focusListener, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            }
        } catch (RuntimeException ex) {
            DiagLog.e("ring", "audio focus failed", ex);
        }
    }

    @SuppressWarnings("deprecation")
    private void abandonFocus() {
        if (audio == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
            } else {
                audio.abandonAudioFocus(focusListener);
            }
        } catch (RuntimeException ignored) {
            // ignore
        }
    }

    private boolean isInCall() {
        if (audio == null) return false;
        int mode = audio.getMode();
        return mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION;
    }

    private void updateVibration() {
        // During a call: vibrate only (even if the alarm's vibration is off). Silenced: nothing.
        boolean should = !silenced && (vibrateEnabled || inCall);
        if (should) startVibration();
        else stopVibration();
    }

    @SuppressWarnings("deprecation")
    private Vibrator vibrator() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm == null ? null : vm.getDefaultVibrator();
        }
        return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
    }

    @SuppressWarnings("deprecation")
    private void startVibration() {
        if (vibrating) return;
        Vibrator v = vibrator();
        if (v == null || !v.hasVibrator()) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                v.vibrate(
                    VibrationEffect.createWaveform(VIBRATION_PATTERN, 0),
                    VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM)
                );
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(VIBRATION_PATTERN, 0), alarmAttributes());
            } else {
                v.vibrate(VIBRATION_PATTERN, 0, alarmAttributes());
            }
            vibrating = true;
        } catch (RuntimeException ex) {
            DiagLog.e("ring", "vibration failed", ex);
        }
    }

    private void stopVibration() {
        if (!vibrating) return;
        Vibrator v = vibrator();
        if (v != null) v.cancel();
        vibrating = false;
    }

    private void stopSelfCompletely() {
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        } catch (RuntimeException ignored) {
            // ignore
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(callPoll);
        if (episode != null && episode.sessionId.equals(aliveSession)) aliveSession = null;
        if (instance == this) instance = null;
        player.stop();
        stopVibration();
        volumeLock.unlock();
        abandonFocus();
        releaseWakeLock();
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        } catch (RuntimeException ignored) {
            // ignore
        }
        Notifications.cancel(this, RouseConstants.NOTIF_RING);
        episode = null;
        super.onDestroy();
    }
}
