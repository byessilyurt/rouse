package app.rouse.alarm.model;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The current wake episode (ActiveRing in src/platform/AlarmBackend.ts) plus native-only fields.
 * Mutable; owned by RingEngine and only touched on the "rouse-state" thread. Persisted as JSON
 * (plan §3.5: ActiveRing JSON + uiReady, ringUiLaunchedAt, silenceUntil).
 */
public final class Episode {

    public static final String STATE_RINGING = "ringing";
    public static final String STATE_SNOOZED = "snoozed";
    public static final String STATE_WAKE_CHECK_WAIT = "wake-check-wait";
    public static final String STATE_WAKE_CHECK_PROMPT = "wake-check-prompt";

    public static final String SOURCE_SCHEDULED = "scheduled";
    public static final String SOURCE_SNOOZE = "snooze";
    public static final String SOURCE_SAFETY = "safety";
    public static final String SOURCE_WAKE_CHECK = "wake-check";
    public static final String SOURCE_CATCH_UP = "catch-up";
    public static final String SOURCE_TEST = "test";

    /** ActiveRing field names, in contract order. */
    public static final String[] ACTIVE_RING_KEYS = {
        "sessionId", "alarmId", "alarm", "source", "state", "scheduledFor", "episodeStartedAt", "ringStartedAt",
        "snoozeCount", "snoozeUntil", "wakeCheckAt", "wakeCheckDeadlineAt", "wakeCheckReRings", "silenced",
        "nativeFallbackShown", "isTest",
    };

    // ── ActiveRing fields ──
    public String sessionId;
    public String alarmId;
    public AlarmSpec alarm;
    public String source;
    public String state;
    public Long scheduledFor;
    public long episodeStartedAt;
    public Long ringStartedAt;
    public int snoozeCount;
    public Long snoozeUntil;
    public Long wakeCheckAt;
    public Long wakeCheckDeadlineAt;
    public int wakeCheckReRings;
    public boolean silenced;
    public boolean nativeFallbackShown;
    public boolean isTest;

    // ── Native-only ──
    public boolean uiReady;
    public Long ringUiLaunchedAt;
    public Long silenceUntil;

    public Episode() {}

    public boolean isRinging() {
        return STATE_RINGING.equals(state);
    }

    public boolean isWakeCheck() {
        return STATE_WAKE_CHECK_WAIT.equals(state) || STATE_WAKE_CHECK_PROMPT.equals(state);
    }

    /** Exactly the ActiveRing shape: every key present, nullable ones as JSON null. */
    public JSONObject toActiveRingJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("sessionId", sessionId);
            o.put("alarmId", alarmId);
            o.put("alarm", alarm.toJson());
            o.put("source", source);
            o.put("state", state);
            o.put("scheduledFor", nullable(scheduledFor));
            o.put("episodeStartedAt", episodeStartedAt);
            o.put("ringStartedAt", nullable(ringStartedAt));
            o.put("snoozeCount", snoozeCount);
            o.put("snoozeUntil", nullable(snoozeUntil));
            o.put("wakeCheckAt", nullable(wakeCheckAt));
            o.put("wakeCheckDeadlineAt", nullable(wakeCheckDeadlineAt));
            o.put("wakeCheckReRings", wakeCheckReRings);
            o.put("silenced", silenced);
            o.put("nativeFallbackShown", nativeFallbackShown);
            o.put("isTest", isTest);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        return o;
    }

    /** Persisted form: ActiveRing + native-only fields. */
    public JSONObject toStorageJson() {
        JSONObject o = toActiveRingJson();
        try {
            o.put("uiReady", uiReady);
            o.put("ringUiLaunchedAt", nullable(ringUiLaunchedAt));
            o.put("silenceUntil", nullable(silenceUntil));
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        return o;
    }

    public static Episode fromJson(JSONObject o) throws JSONException {
        Episode e = new Episode();
        e.sessionId = requireString(o, "sessionId");
        e.alarmId = requireString(o, "alarmId");
        JSONObject alarm = o.optJSONObject("alarm");
        if (alarm == null) throw new JSONException("episode.alarm missing");
        e.alarm = AlarmSpec.fromJson(alarm);
        e.source = requireString(o, "source");
        e.state = requireString(o, "state");
        e.scheduledFor = AlarmSpec.optNullableLong(o, "scheduledFor");
        e.episodeStartedAt = o.optLong("episodeStartedAt", 0L);
        e.ringStartedAt = AlarmSpec.optNullableLong(o, "ringStartedAt");
        e.snoozeCount = o.optInt("snoozeCount", 0);
        e.snoozeUntil = AlarmSpec.optNullableLong(o, "snoozeUntil");
        e.wakeCheckAt = AlarmSpec.optNullableLong(o, "wakeCheckAt");
        e.wakeCheckDeadlineAt = AlarmSpec.optNullableLong(o, "wakeCheckDeadlineAt");
        e.wakeCheckReRings = o.optInt("wakeCheckReRings", 0);
        e.silenced = o.optBoolean("silenced", false);
        e.nativeFallbackShown = o.optBoolean("nativeFallbackShown", false);
        e.isTest = o.optBoolean("isTest", false);
        e.uiReady = o.optBoolean("uiReady", false);
        e.ringUiLaunchedAt = AlarmSpec.optNullableLong(o, "ringUiLaunchedAt");
        e.silenceUntil = AlarmSpec.optNullableLong(o, "silenceUntil");
        return e;
    }

    public Episode copy() {
        try {
            return fromJson(toStorageJson());
        } catch (JSONException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static Object nullable(Long v) {
        return v == null ? JSONObject.NULL : (Object) v;
    }

    private static String requireString(JSONObject o, String key) throws JSONException {
        Object v = o.opt(key);
        if (!(v instanceof String)) throw new JSONException("episode." + key + " missing");
        return (String) v;
    }
}
