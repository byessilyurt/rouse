package app.rouse.alarm;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import app.rouse.alarm.model.Episode;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.Random;

/**
 * Native fallback mission (D-008, D-032): shown when the WebView ring UI is not ready within
 * NATIVE_UI_READY_TIMEOUT_MS, or before first unlock (the WebView cannot run then). Five
 * "two-digit × one-digit + two-digit" problems; Back and the volume keys are blocked.
 * directBootAware, showWhenLocked. Programmatic layout (no XML, no WebView).
 */
public class FallbackMissionActivity extends AppCompatActivity implements RingEngine.UiListener {

    private static final String STATE_SOLVED = "solved";

    private final Random rng = new SecureRandom();
    private String sessionId;
    private FallbackMath current;
    private int solved;
    private boolean done;
    private TextView progressView;
    private TextView problemView;
    private TextView feedbackView;
    private EditText input;
    private Button checkButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        sessionId = getIntent() == null ? null : getIntent().getStringExtra(RouseConstants.EXTRA_SESSION_ID);
        if (savedInstanceState != null) solved = savedInstanceState.getInt(STATE_SOLVED, 0);
        setContentView(buildLayout());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Blocked: solving the problems is the only way to stop the alarm.
            }
        });
        nextProblem(null);
        if (sessionId != null) RingEngine.get(this).nativeFallbackShown(sessionId);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String sid = intent == null ? null : intent.getStringExtra(RouseConstants.EXTRA_SESSION_ID);
        if (sid != null && !sid.equals(sessionId)) {
            sessionId = sid;
            solved = 0;
            done = false;
            checkButton.setEnabled(true);
            input.setEnabled(true);
            nextProblem(null);
            RingEngine.get(this).nativeFallbackShown(sid);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        RingEngine engine = RingEngine.get(this);
        engine.addUiListener(this);
        onEpisodeChanged(engine.snapshot());
    }

    @Override
    protected void onStop() {
        RingEngine.get(this).removeUiListener(this);
        super.onStop();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putInt(STATE_SOLVED, solved);
    }

    @SuppressWarnings("deprecation")
    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private TextView text(float sp, boolean bold) {
        TextView t = new TextView(this);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private LinearLayout buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.rgb(16, 20, 24));
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);

        TextView title = text(26, true);
        title.setText("Wake up");
        root.addView(title, wrap());

        TextView subtitle = text(16, false);
        subtitle.setText(String.format(Locale.US, "Solve %d problems to stop the alarm.", RouseConstants.NATIVE_FALLBACK_PROBLEMS));
        subtitle.setPadding(0, dp(8), 0, dp(24));
        root.addView(subtitle, wrap());

        progressView = text(16, false);
        progressView.setAccessibilityLiveRegion(TextView.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(progressView, wrap());

        problemView = text(40, true);
        problemView.setPadding(0, dp(16), 0, dp(16));
        root.addView(problemView, wrap());

        input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_SIGNED);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.GRAY);
        input.setHint("Answer");
        input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        input.setGravity(Gravity.CENTER);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        input.setMinHeight(dp(56));
        input.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE
                || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN)) {
                submit();
                return true;
            }
            return false;
        });
        LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(dp(220), ViewGroup.LayoutParams.WRAP_CONTENT);
        inputLp.gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(input, inputLp);

        checkButton = new Button(this);
        checkButton.setText("Check");
        checkButton.setMinHeight(dp(56));
        checkButton.setOnClickListener(v -> submit());
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(dp(220), ViewGroup.LayoutParams.WRAP_CONTENT);
        btnLp.gravity = Gravity.CENTER_HORIZONTAL;
        btnLp.topMargin = dp(16);
        root.addView(checkButton, btnLp);

        feedbackView = text(16, false);
        feedbackView.setPadding(0, dp(16), 0, 0);
        feedbackView.setAccessibilityLiveRegion(TextView.ACCESSIBILITY_LIVE_REGION_ASSERTIVE);
        root.addView(feedbackView, wrap());
        return root;
    }

    private static LinearLayout.LayoutParams wrap() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        return lp;
    }

    private void nextProblem(String feedback) {
        current = FallbackMath.next(rng);
        int shown = Math.min(solved + 1, RouseConstants.NATIVE_FALLBACK_PROBLEMS);
        progressView.setText(String.format(Locale.US, "Problem %d of %d", shown, RouseConstants.NATIVE_FALLBACK_PROBLEMS));
        problemView.setText(current.text());
        problemView.setContentDescription(current.a + " times " + current.b + " plus " + current.c);
        feedbackView.setText(feedback == null ? "" : feedback);
        input.setText("");
        input.requestFocus();
    }

    private void submit() {
        if (done || current == null) return;
        if (current.check(input.getText().toString())) {
            solved++;
            if (solved >= RouseConstants.NATIVE_FALLBACK_PROBLEMS) {
                done = true;
                checkButton.setEnabled(false);
                input.setEnabled(false);
                feedbackView.setText("Done. Good morning!");
                if (sessionId != null) RingEngine.get(this).dismissFromNativeFallback(sessionId);
                else finish();
                return;
            }
            nextProblem("Correct.");
        } else {
            nextProblem("Not quite. Here's a new one.");
        }
    }

    // ── RingEngine.UiListener ──

    @Override
    public void onEpisodeChanged(Episode episode) {
        if (episode == null || !episode.isRinging()) {
            finish();
            return;
        }
        if (sessionId == null) {
            sessionId = episode.sessionId;
            RingEngine.get(this).nativeFallbackShown(sessionId);
        } else if (!sessionId.equals(episode.sessionId)) {
            // A new episode replaced ours: start over for it.
            sessionId = episode.sessionId;
            solved = 0;
            done = false;
            checkButton.setEnabled(true);
            input.setEnabled(true);
            nextProblem(null);
            RingEngine.get(this).nativeFallbackShown(sessionId);
        }
    }

    @Override
    public boolean onNativeFallbackRequested(String sid) {
        return true; // already on screen
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (MainActivity.isVolumeKey(event.getKeyCode())) return true;
        return super.dispatchKeyEvent(event);
    }
}
