package app.rouse.alarm.store;

import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/** Durable AlarmLogEvent queue ("log" key), backed by the pure EventLog. */
@SuppressLint("ApplySharedPref")
public final class LogStore {

    private static final String KEY = "log";

    private final SharedPreferences prefs;

    public LogStore(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    private EventLog load() {
        return EventLog.parse(prefs.getString(KEY, null));
    }

    private void save(EventLog log) {
        prefs.edit().putString(KEY, log.serialize()).commit();
    }

    public JSONObject append(String type, long at, String sessionId, String alarmId, JSONObject fields) {
        EventLog log = load();
        JSONObject ev = log.append(type, at, sessionId, alarmId, fields);
        save(log);
        return ev;
    }

    public JSONArray after(long afterSeq) {
        return load().after(afterSeq);
    }

    public long lastSeq() {
        return load().lastSeq();
    }

    public void ack(long throughSeq) {
        EventLog log = load();
        log.ack(throughSeq);
        save(log);
    }
}
