package app.rouse.alarm;

/**
 * Pure decision for "is a phone/VoIP call holding the alarm silent?" (D-049). Calls are detected from
 * AudioManager.getMode() (IN_CALL / IN_COMMUNICATION), which a VoIP app can leave stuck forever; an alarm
 * must never stay silent for good, so a call mode that lasted longer than the cap while ringing no longer
 * counts. `since` is a monotonic timestamp (ms) of when the mode was first seen as a call, or NONE.
 */
public final class CallPolicy {

    public static final long NONE = -1L;

    private CallPolicy() {}

    /** The new "call mode since" after seeing `modeIsCall` at `nowMs`: kept while the mode persists, reset when it ends. */
    public static long track(boolean modeIsCall, long since, long nowMs) {
        if (!modeIsCall) return NONE;
        return since == NONE ? nowMs : since;
    }

    /** True while the call should keep the alarm vibrate-only: the mode is a call and has lasted at most `capMs`. */
    public static boolean holdsAudio(boolean modeIsCall, long since, long nowMs, long capMs) {
        return modeIsCall && since != NONE && nowMs - since <= capMs;
    }
}
