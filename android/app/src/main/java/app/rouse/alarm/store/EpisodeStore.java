package app.rouse.alarm.store;

import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import app.rouse.alarm.DiagLog;
import app.rouse.alarm.model.Episode;
import org.json.JSONException;
import org.json.JSONObject;

/** The current episode ("episode" key; absent = none). commit() before anything audible. */
@SuppressLint("ApplySharedPref")
public final class EpisodeStore {

    private static final String KEY = "episode";

    private final SharedPreferences prefs;

    public EpisodeStore(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    public Episode get() {
        String s = prefs.getString(KEY, null);
        if (s == null) return null;
        try {
            return Episode.fromJson(new JSONObject(s));
        } catch (JSONException e) {
            DiagLog.w("episode", "corrupt episode dropped: " + e.getMessage());
            return null;
        }
    }

    public boolean put(Episode e) {
        return prefs.edit().putString(KEY, e.toStorageJson().toString()).commit();
    }

    public boolean clear() {
        return prefs.edit().remove(KEY).commit();
    }
}
