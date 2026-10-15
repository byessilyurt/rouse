package app.rouse.alarm;

import app.rouse.alarm.model.Episode;

/**
 * D-014 collision policy, as a pure function so it can be unit-tested.
 * <ul>
 *   <li>No episode → start a new one.</li>
 *   <li>A real alarm fires while a real episode is ringing → MERGE (logged 'merged').</li>
 *   <li>A real alarm fires during a snooze or wake check → SUPERSEDE the old episode.</li>
 *   <li>A real alarm fires during a test episode (any state) → SUPERSEDE it silently.</li>
 *   <li>A test fires while a real episode exists → IGNORE the test (tests never supersede).</li>
 *   <li>A test fires during another test episode → SUPERSEDE (replace) it.</li>
 * </ul>
 * (Alarms due at the same instant arrive together and are merged before this is consulted.)
 */
public final class CollisionPolicy {

    private CollisionPolicy() {}

    public enum Decision {
        START_NEW,
        MERGE_INTO_RINGING,
        SUPERSEDE,
        IGNORE_INCOMING,
    }

    public static Decision decide(String existingState, boolean existingIsTest, boolean incomingIsTest) {
        if (existingState == null) return Decision.START_NEW;
        if (incomingIsTest) {
            return existingIsTest ? Decision.SUPERSEDE : Decision.IGNORE_INCOMING;
        }
        if (existingIsTest) return Decision.SUPERSEDE;
        if (Episode.STATE_RINGING.equals(existingState)) return Decision.MERGE_INTO_RINGING;
        return Decision.SUPERSEDE;
    }

    public static Decision decide(Episode existing, boolean incomingIsTest) {
        if (existing == null) return Decision.START_NEW;
        return decide(existing.state, existing.isTest, incomingIsTest);
    }
}
