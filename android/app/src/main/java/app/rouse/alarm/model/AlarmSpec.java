package app.rouse.alarm.model;

import app.rouse.alarm.ScheduleMath;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Parsed, read-only view of an Alarm JSON object (src/core/types.ts `Alarm`). The original JSON is
 * kept verbatim (unknown fields included) so that ActiveRing.alarm round-trips everything JS sent.
 * Only id/hour/minute are mandatory; every other field falls back to a safe default.
 */
public final class AlarmSpec implements ScheduleMath.Schedulable {

    private final JSONObject raw;

    public final String id;
    public final int hour;
    public final int minute;
    public final int[] days;
    public final boolean enabled;
    public final String label;
    public final Long skipUntil;
    public final boolean deleteAfterRing;
    /** "bundled" or "custom". */
    public final String soundKind;
    public final String soundId;
    public final String soundName;
    public final int volume;
    public final int volumeRampSec;
    public final boolean vibrate;
    public final boolean snoozeEnabled;
    public final int snoozeIntervalMin;
    public final int snoozeMaxCount;
    public final boolean snoozeRequireMission;
    public final boolean wakeCheckEnabled;
    public final int wakeCheckDelayMin;
    public final int wakeCheckWindowMin;
    public final long createdAt;
    public final long updatedAt;

    private AlarmSpec(JSONObject raw) throws JSONException {
        this.raw = raw;
        Object idVal = raw.opt("id");
        if (!(idVal instanceof String) || ((String) idVal).isEmpty()) throw new JSONException("alarm.id missing");
        this.id = (String) idVal;
        this.hour = requireInt(raw, "hour", 0, 23);
        this.minute = requireInt(raw, "minute", 0, 59);
        this.days = parseDays(raw.optJSONArray("days"));
        this.enabled = raw.optBoolean("enabled", false);
        this.label = raw.isNull("label") ? "" : raw.optString("label", "");
        this.skipUntil = optNullableLong(raw, "skipUntil");
        this.deleteAfterRing = raw.optBoolean("deleteAfterRing", false);

        JSONObject sound = raw.optJSONObject("sound");
        String kind = sound == null ? "bundled" : sound.optString("kind", "bundled");
        String sid = sound == null ? null : sound.optString("id", null);
        if (sid == null || sid.isEmpty()) {
            kind = "bundled";
            sid = "pulse";
        }
        this.soundKind = "custom".equals(kind) ? "custom" : "bundled";
        this.soundId = sid;
        this.soundName = sound == null ? "" : sound.optString("name", "");

        this.volume = clamp(raw.optInt("volume", 80), 10, 100);
        this.volumeRampSec = clamp(raw.optInt("volumeRampSec", 0), 0, 300);
        this.vibrate = raw.optBoolean("vibrate", true);

        JSONObject snooze = raw.optJSONObject("snooze");
        this.snoozeEnabled = snooze != null && snooze.optBoolean("enabled", false);
        this.snoozeIntervalMin = clamp(snooze == null ? 5 : snooze.optInt("intervalMin", 5), 1, 60);
        this.snoozeMaxCount = clamp(snooze == null ? 3 : snooze.optInt("maxCount", 3), 1, 10);
        this.snoozeRequireMission = snooze != null && snooze.optBoolean("requireMission", false);

        JSONObject wake = raw.optJSONObject("wakeUpCheck");
        this.wakeCheckEnabled = wake != null && wake.optBoolean("enabled", false);
        this.wakeCheckDelayMin = clamp(wake == null ? 5 : wake.optInt("delayMin", 5), 1, 30);
        this.wakeCheckWindowMin = clamp(wake == null ? 3 : wake.optInt("windowMin", 3), 1, 10);

        this.createdAt = raw.optLong("createdAt", 0L);
        this.updatedAt = raw.optLong("updatedAt", 0L);
    }

    /** Parse an Alarm JSON object. Throws JSONException if id/hour/minute are missing or invalid. */
    public static AlarmSpec fromJson(JSONObject json) throws JSONException {
        if (json == null) throw new JSONException("alarm is null");
        // Defensive copy: callers may mutate their object later.
        return new AlarmSpec(new JSONObject(json.toString()));
    }

    public static AlarmSpec fromJsonString(String json) throws JSONException {
        return new AlarmSpec(new JSONObject(json));
    }

    /** A copy of the verbatim JSON (unknown fields preserved). */
    public JSONObject toJson() {
        try {
            return new JSONObject(raw.toString());
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Same alarm with `enabled` replaced (used when a one-off fires). */
    public AlarmSpec withEnabled(boolean value) {
        try {
            JSONObject copy = toJson();
            copy.put("enabled", value);
            return new AlarmSpec(copy);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    public boolean isOneOff() {
        return days.length == 0;
    }

    // ── ScheduleMath.Schedulable ──
    @Override public String getId() { return id; }
    @Override public int getHour() { return hour; }
    @Override public int getMinute() { return minute; }
    @Override public int[] getDays() { return days.clone(); }
    @Override public Long getSkipUntil() { return skipUntil; }
    @Override public boolean isEnabled() { return enabled; }
    @Override public long getCreatedAt() { return createdAt; }

    // ── helpers ──
    private static int requireInt(JSONObject o, String key, int min, int max) throws JSONException {
        if (!o.has(key) || o.isNull(key)) throw new JSONException("alarm." + key + " missing");
        Object v = o.get(key);
        if (!(v instanceof Number)) throw new JSONException("alarm." + key + " not a number");
        double d = ((Number) v).doubleValue();
        if (d != Math.floor(d) || d < min || d > max) throw new JSONException("alarm." + key + " out of range");
        return (int) d;
    }

    private static int[] parseDays(JSONArray arr) {
        if (arr == null) return new int[0];
        boolean[] seen = new boolean[7];
        int n = 0;
        for (int i = 0; i < arr.length(); i++) {
            Object v = arr.opt(i);
            if (!(v instanceof Number)) continue;
            int d = ((Number) v).intValue();
            if (d >= 0 && d <= 6 && !seen[d]) {
                seen[d] = true;
                n++;
            }
        }
        int[] out = new int[n];
        int k = 0;
        for (int d = 0; d < 7; d++) {
            if (seen[d]) out[k++] = d;
        }
        return out;
    }

    /** Long value, or null if absent / JSON null / not a number. */
    public static Long optNullableLong(JSONObject o, String key) {
        if (o == null || !o.has(key) || o.isNull(key)) return null;
        Object v = o.opt(key);
        if (v instanceof Number) return ((Number) v).longValue();
        return null;
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
