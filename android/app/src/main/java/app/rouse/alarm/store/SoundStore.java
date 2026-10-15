package app.rouse.alarm.store;

import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Custom sounds: [{"id","name","file","durationMs","addedAt"}] ("sounds" key). */
@SuppressLint("ApplySharedPref")
public final class SoundStore {

    private static final String KEY = "sounds";

    private final SharedPreferences prefs;

    public SoundStore(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    public synchronized JSONArray list() {
        String s = prefs.getString(KEY, null);
        if (s == null) return new JSONArray();
        try {
            return new JSONArray(s);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    public synchronized JSONObject find(String id) {
        JSONArray arr = list();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    public synchronized boolean add(JSONObject sound) {
        JSONArray arr = list();
        arr.put(sound);
        return prefs.edit().putString(KEY, arr.toString()).commit();
    }

    /** Removes the entry and returns it (or null). */
    public synchronized JSONObject remove(String id) {
        JSONArray arr = list();
        JSONArray kept = new JSONArray();
        JSONObject removed = null;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            if (removed == null && id.equals(o.optString("id"))) removed = o;
            else kept.put(o);
        }
        if (removed != null) prefs.edit().putString(KEY, kept.toString()).commit();
        return removed;
    }
}
