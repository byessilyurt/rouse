package app.rouse.alarm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import app.rouse.alarm.CollisionPolicy.Decision;
import app.rouse.alarm.model.Episode;
import java.util.Random;
import org.junit.Test;

/** D-014 collision policy and the native fallback problem generator. */
public class CollisionPolicyTest {

    @Test
    public void noEpisodeStartsNew() {
        assertEquals(Decision.START_NEW, CollisionPolicy.decide((Episode) null, false));
        assertEquals(Decision.START_NEW, CollisionPolicy.decide((Episode) null, true));
    }

    @Test
    public void realFireWhileRealRingingMerges() {
        assertEquals(Decision.MERGE_INTO_RINGING, CollisionPolicy.decide(Episode.STATE_RINGING, false, false));
    }

    @Test
    public void realFireDuringSnoozeOrWakeCheckSupersedes() {
        assertEquals(Decision.SUPERSEDE, CollisionPolicy.decide(Episode.STATE_SNOOZED, false, false));
        assertEquals(Decision.SUPERSEDE, CollisionPolicy.decide(Episode.STATE_WAKE_CHECK_WAIT, false, false));
        assertEquals(Decision.SUPERSEDE, CollisionPolicy.decide(Episode.STATE_WAKE_CHECK_PROMPT, false, false));
    }

    @Test
    public void testRingsNeverSupersedeRealOnes() {
        for (String s : new String[] {
            Episode.STATE_RINGING, Episode.STATE_SNOOZED, Episode.STATE_WAKE_CHECK_WAIT, Episode.STATE_WAKE_CHECK_PROMPT,
        }) {
            assertEquals(s, Decision.IGNORE_INCOMING, CollisionPolicy.decide(s, false, true));
        }
    }

    @Test
    public void realFireReplacesATestEpisode() {
        assertEquals(Decision.SUPERSEDE, CollisionPolicy.decide(Episode.STATE_RINGING, true, false));
        assertEquals(Decision.SUPERSEDE, CollisionPolicy.decide(Episode.STATE_SNOOZED, true, false));
    }

    @Test
    public void testReplacesATestEpisode() {
        assertEquals(Decision.SUPERSEDE, CollisionPolicy.decide(Episode.STATE_RINGING, true, true));
    }

    @Test
    public void fallbackProblemsAreTwoDigitTimesOneDigitPlusTwoDigit() {
        Random rng = new Random(42);
        for (int i = 0; i < 2000; i++) {
            FallbackMath p = FallbackMath.next(rng);
            assertTrue(p.a >= 12 && p.a <= 49);
            assertTrue(p.b >= 3 && p.b <= 9);
            assertTrue(p.c >= 11 && p.c <= 99);
            assertTrue(p.check(Integer.toString(p.answer())));
            assertTrue(p.check(" " + p.answer() + " "));
            assertTrue(!p.check(Integer.toString(p.answer() + 1)));
            assertTrue(!p.check(""));
            assertTrue(!p.check("abc"));
        }
    }

    @Test
    public void rampGainIsDbLinear() {
        assertEquals(1f, AlarmPlayer.rampGain(0, 0), 0f);
        assertEquals(Math.pow(10, -30 / 20.0), AlarmPlayer.rampGain(0, 30_000), 1e-6);
        assertEquals(Math.pow(10, -15 / 20.0), AlarmPlayer.rampGain(15_000, 30_000), 1e-6);
        assertEquals(1f, AlarmPlayer.rampGain(30_000, 30_000), 0f);
    }

    @Test
    public void volumeIndexIsAtLeastOne() {
        assertEquals(1, VolumeLock.indexFor(10, 7));
        assertEquals(7, VolumeLock.indexFor(100, 7));
        assertEquals(4, VolumeLock.indexFor(50, 7));
    }
}
