package app.rouse.alarm;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import app.rouse.alarm.model.Episode;
import com.getcapacitor.BridgeActivity;

/**
 * The single WebView activity (D-018). While an episode is ringing it shows over the lock screen,
 * turns the screen on, keeps it on, blocks Back and consumes the volume keys; the flags are cleared
 * when the ring ends. Ring / wake-check full-screen intents arrive here with
 * EXTRA_RING_SESSION / EXTRA_WAKE_CHECK_SESSION.
 */
public class MainActivity extends BridgeActivity implements RingEngine.UiListener {

    private OnBackPressedCallback backBlocker;
    private boolean ringMode;
    private boolean lockScreenFlags;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RousePlugin.class); // must precede super.onCreate (bridge creation)
        super.onCreate(savedInstanceState);
        backBlocker = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                // Back is blocked while ringing: the mission (or the native fallback) is the only way out.
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backBlocker);
        handleRouseIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRouseIntent(intent);
    }

    @Override
    public void onStart() {
        super.onStart();
        RingEngine engine = RingEngine.get(this);
        engine.addUiListener(this);
        onEpisodeChanged(engine.snapshot());
    }

    @Override
    public void onResume() {
        super.onResume();
        // Visible now: a refused background FGS start (D-051) can be retried with certainty here.
        if (ringMode) RingEngine.get(this).ensureRingServiceFromForeground();
    }

    @Override
    public void onStop() {
        RingEngine.get(this).removeUiListener(this);
        super.onStop();
    }

    private void handleRouseIntent(Intent intent) {
        if (intent == null) return;
        String ringSession = intent.getStringExtra(RouseConstants.EXTRA_RING_SESSION);
        if (ringSession != null) {
            setRingMode(true);
            RingEngine.get(this).ringUiLaunched(ringSession);
            return;
        }
        if (intent.getStringExtra(RouseConstants.EXTRA_WAKE_CHECK_SESSION) != null) {
            setLockScreenFlags(true);
        }
    }

    // ── RingEngine.UiListener (main thread) ──

    @Override
    public void onEpisodeChanged(Episode episode) {
        if (episode != null && episode.isRinging()) {
            setRingMode(true);
        } else if (episode != null && Episode.STATE_WAKE_CHECK_PROMPT.equals(episode.state)) {
            setRingMode(false);
            setLockScreenFlags(true);
        } else {
            setRingMode(false);
            setLockScreenFlags(false);
        }
    }

    @Override
    public boolean onNativeFallbackRequested(String sessionId) {
        if (isFinishing()) return false;
        Intent i = new Intent(this, FallbackMissionActivity.class);
        i.putExtra(RouseConstants.EXTRA_SESSION_ID, sessionId);
        try {
            startActivity(i);
            return true;
        } catch (RuntimeException e) {
            DiagLog.e("main", "fallback launch failed", e);
            return false;
        }
    }

    // ── Lock-screen / key handling ──

    private void setRingMode(boolean on) {
        ringMode = on;
        if (backBlocker != null) backBlocker.setEnabled(on);
        if (on) setLockScreenFlags(true);
    }

    @SuppressWarnings("deprecation")
    private void setLockScreenFlags(boolean on) {
        if (on == lockScreenFlags) return;
        lockScreenFlags = on;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        } else {
            int flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            if (on) getWindow().addFlags(flags);
            else getWindow().clearFlags(flags);
        }
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (ringMode && isVolumeKey(event.getKeyCode())) {
            return true; // consumed: the alarm volume is locked while ringing (D-021)
        }
        return super.dispatchKeyEvent(event);
    }

    static boolean isVolumeKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_VOLUME_UP
            || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN
            || keyCode == KeyEvent.KEYCODE_VOLUME_MUTE;
    }
}
