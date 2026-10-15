package app.rouse.alarm.store;

import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import app.rouse.alarm.DiagLog;
import app.rouse.alarm.model.AlarmSpec;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The alarm mirror and scheduling bookkeeping (plan §3.5):
 * <pre>
 * mirror    = {"mirrorVersion":1,"syncedAt":ms,"alarms":[Alarm JSON verbatim],"settings":{...}}
 * scheduled = {"fireAt":ms|null,"alarmId":id|null,"alarmIds":[..],"bedtimeAt":ms|null}
 * </pre>
 * plus "lastHandledFireAt" (dedupe of main fires vs catch-up), "pendingCatchUp" and "pendingTest".
 * Every write uses commit(): the state must be on disk before anything audible happens.
 */
@SuppressLint("ApplySharedPref")
public final class MirrorStore {

    private static final String KEY_MIRROR = "mirror";
    private static final String KEY_SCHEDULED = "scheduled";
    private static final String KEY_LAST_HANDLED = "lastHandledFireAt";
    private static final String KEY_PENDING_CATCH_UP = "pendingCatchUp";
    private static final String KEY_PENDING_TEST = "pendingTest";
    private static final String KEY_LAST_BEDTIME = "lastBedtimeAt";

    private final SharedPreferences prefs;

    public MirrorStore(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    public boolean writeMirror(JSONObject mirror) {
        return prefs.edit().putString(KEY_MIRROR, mirror.toString()).commit();
    }

    public JSONObject readMirror() {
        String s = prefs.getString(KEY_MIRROR, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            DiagLog.w("mirror", "corrupt mirror ignored");
            return null;
        }
    }

    /** All mirrored alarms (malformed entries skipped). */
    public List<AlarmSpec> readAlarms() {
        List<AlarmSpec> out = new ArrayList<>();
        JSONObject m = readMirror();
        if (m == null) return out;
        JSONArray arr = m.optJSONArray("alarms");
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            try {
                out.add(AlarmSpec.fromJson(o));
            } catch (JSONException e) {
                DiagLog.w("mirror", "skipped malformed alarm #" + i);
            }
        }
        return out;
    }

    /** Settings mirror; empty object if none. */
    public JSONObject readSettings() {
        JSONObject m = readMirror();
        JSONObject s = m == null ? null : m.optJSONObject("settings");
        return s == null ? new JSONObject() : s;
    }

    /** Replace one alarm (by id) in the mirror; no-op if absent. */
    public boolean replaceAlarm(AlarmSpec alarm) {
        JSONObject m = readMirror();
        if (m == null) return false;
        JSONArray arr = m.optJSONArray("alarms");
        if (arr == null) return false;
        try {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && alarm.id.equals(o.optString("id"))) {
                    arr.put(i, alarm.toJson());
                    m.put("alarms", arr);
                    return writeMirror(m);
                }
            }
        } catch (JSONException e) {
            DiagLog.w("mirror", "replaceAlarm failed: " + e.getMessage());
        }
        return false;
    }

    // ── scheduled ──

    public JSONObject readScheduled() {
        String s = prefs.getString(KEY_SCHEDULED, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            return null;
        }
    }

    public boolean writeScheduled(JSONObject scheduled) {
        return prefs.edit().putString(KEY_SCHEDULED, scheduled.toString()).commit();
    }

    public long lastHandledFireAt() {
        return prefs.getLong(KEY_LAST_HANDLED, 0L);
    }

    public boolean setLastHandledFireAt(long fireAt) {
        return prefs.edit().putLong(KEY_LAST_HANDLED, fireAt).commit();
    }

    /** Last bedtime reminder delivered (so an early delivery is never re-armed for the same instant). */
    public long lastBedtimeAt() {
        return prefs.getLong(KEY_LAST_BEDTIME, 0L);
    }

    public boolean setLastBedtimeAt(long at) {
        return prefs.edit().putLong(KEY_LAST_BEDTIME, at).commit();
    }

    // ── pending catch-up ring (reconcile → deferred start) ──

    public Long pendingCatchUp() {
        long v = prefs.getLong(KEY_PENDING_CATCH_UP, -1L);
        return v < 0 ? null : v;
    }

    public boolean setPendingCatchUp(Long fireAt) {
        SharedPreferences.Editor ed = prefs.edit();
        if (fireAt == null) ed.remove(KEY_PENDING_CATCH_UP);
        else ed.putLong(KEY_PENDING_CATCH_UP, fireAt);
        return ed.commit();
    }

    // ── pending test ring: {"fireAt":ms,"alarm":{...}} ──

    public JSONObject pendingTest() {
        String s = prefs.getString(KEY_PENDING_TEST, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            return null;
        }
    }

    public boolean setPendingTest(JSONObject pending) {
        SharedPreferences.Editor ed = prefs.edit();
        if (pending == null) ed.remove(KEY_PENDING_TEST);
        else ed.putString(KEY_PENDING_TEST, pending.toString());
        return ed.commit();
    }
}
