package app.rouse.alarm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** D-049: a call/VoIP audio mode holds the alarm vibrate-only, but never longer than CALL_MODE_CAP_MS. */
public class CallPolicyTest {

    private static final long CAP = RouseConstants.CALL_MODE_CAP_MS;

    @Test
    public void capIsTenMinutes() {
        assertEquals(10L * 60_000L, CAP);
    }

    @Test
    public void noCallModeNeverHoldsAudio() {
        assertFalse(CallPolicy.holdsAudio(false, CallPolicy.NONE, 1_000L, CAP));
        assertFalse(CallPolicy.holdsAudio(false, 0L, 1_000L, CAP));
    }

    @Test
    public void trackStartsWhenTheModeIsFirstSeenAndKeepsItWhileItPersists() {
        long since = CallPolicy.track(true, CallPolicy.NONE, 5_000L);
        assertEquals(5_000L, since);
        assertEquals(5_000L, CallPolicy.track(true, since, 99_000L));
    }

    @Test
    public void trackResetsWhenTheModeEnds() {
        assertEquals(CallPolicy.NONE, CallPolicy.track(false, 5_000L, 9_000L));
        // A later call is a new call: the cap restarts.
        assertEquals(50_000L, CallPolicy.track(true, CallPolicy.NONE, 50_000L));
    }

    @Test
    public void callHoldsAudioUpToAndIncludingTheCap() {
        long since = 1_000L;
        assertTrue(CallPolicy.holdsAudio(true, since, since, CAP));
        assertTrue(CallPolicy.holdsAudio(true, since, since + CAP - 1, CAP));
        assertTrue(CallPolicy.holdsAudio(true, since, since + CAP, CAP));
    }

    @Test
    public void stuckCallModeReleasesTheAlarmAfterTheCap() {
        long since = 1_000L;
        assertFalse(CallPolicy.holdsAudio(true, since, since + CAP + 1, CAP));
        assertFalse(CallPolicy.holdsAudio(true, since, since + 3 * CAP, CAP));
    }

    @Test
    public void pollingSequenceStaysReleasedUntilTheModeEndsThenARealCallHoldsAgain() {
        long since = CallPolicy.NONE;
        long t = 0L;
        // 2 s polls through a stuck VoIP mode: held for the first 10 min, released after.
        boolean heldAtStart = false;
        boolean heldAfterCap = true;
        for (; t <= CAP + 4_000L; t += 2_000L) {
            since = CallPolicy.track(true, since, t);
            boolean held = CallPolicy.holdsAudio(true, since, t, CAP);
            if (t == 0L) heldAtStart = held;
            if (t == CAP + 2_000L) heldAfterCap = held;
        }
        assertTrue(heldAtStart);
        assertFalse(heldAfterCap);
        // The mode ends, then a genuine call starts: held again.
        since = CallPolicy.track(false, since, t);
        assertFalse(CallPolicy.holdsAudio(false, since, t, CAP));
        t += 2_000L;
        since = CallPolicy.track(true, since, t);
        assertTrue(CallPolicy.holdsAudio(true, since, t, CAP));
    }
}
