package app.rouse.alarm.store;

import app.rouse.alarm.RouseConstants;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Pure (Android-free) durable log state: {"nextSeq":n,"events":[...]} (plan §3.5, D-026).
 * seq is strictly increasing per install and never reused, even after ack. Capped at
 * NATIVE_LOG_CAP events; the oldest are dropped first.
 */
public final class EventLog {

    private long nextSeq;
    private JSONArray events;

    public EventLog() {
        this.nextSeq = 1;
        this.events = new JSONArray();
    }

    public static EventLog parse(String json) {
        EventLog log = new EventLog();
        if (json == null || json.isEmpty()) return log;
        try {
            JSONObject o = new JSONObject(json);
            log.nextSeq = Math.max(1L, o.optLong("nextSeq", 1L));
            JSONArray arr = o.optJSONArray("events");
            if (arr != null) log.events = arr;
        } catch (JSONException e) {
            // Corrupt log: nothing recoverable, start fresh.
            return new EventLog();
        }
        return log;
    }

    public String serialize() {
        JSONObject o = new JSONObject();
        try {
            o.put("nextSeq", nextSeq);
            o.put("events", events);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        return o.toString();
    }

    /** Highest seq ever issued (0 if none). */
    public long lastSeq() {
        return nextSeq - 1;
    }

    /**
     * Append an event: assigns seq/at/sessionId/alarmId/type and copies `fields` on top.
     * Returns the stored event.
     */
    public JSONObject append(String type, long at, String sessionId, String alarmId, JSONObject fields) {
        JSONObject ev = new JSONObject();
        try {
            ev.put("seq", nextSeq);
            ev.put("at", at);
            ev.put("sessionId", sessionId);
            ev.put("alarmId", alarmId);
            ev.put("type", type);
            if (fields != null) {
                JSONArray names = fields.names();
                if (names != null) {
                    for (int i = 0; i < names.length(); i++) {
                        String k = names.getString(i);
                        ev.put(k, fields.get(k));
                    }
                }
            }
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        nextSeq++;
        events.put(ev);
        trim();
        return ev;
    }

    /** Events with seq > afterSeq, ascending. */
    public JSONArray after(long afterSeq) {
        JSONArray out = new JSONArray();
        for (int i = 0; i < events.length(); i++) {
            JSONObject ev = events.optJSONObject(i);
            if (ev != null && ev.optLong("seq", 0L) > afterSeq) out.put(ev);
        }
        return out;
    }

    /** Drop events with seq <= throughSeq. */
    public void ack(long throughSeq) {
        JSONArray kept = new JSONArray();
        for (int i = 0; i < events.length(); i++) {
            JSONObject ev = events.optJSONObject(i);
            if (ev != null && ev.optLong("seq", 0L) > throughSeq) kept.put(ev);
        }
        events = kept;
    }

    public int size() {
        return events.length();
    }

    private void trim() {
        int over = events.length() - RouseConstants.NATIVE_LOG_CAP;
        if (over <= 0) return;
        JSONArray kept = new JSONArray();
        for (int i = over; i < events.length(); i++) kept.put(events.opt(i));
        events = kept;
    }
}
