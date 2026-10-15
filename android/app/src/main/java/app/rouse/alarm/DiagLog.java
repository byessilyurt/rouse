package app.rouse.alarm;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import app.rouse.alarm.store.NativePrefs;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;

/**
 * 200-line diagnostic ring buffer for "Copy diagnostics". NO personal data: never log labels,
 * QR payloads, file names or phrases — only ids, states, timings and error classes.
 * Persisted (async apply()) in device-protected prefs "rouse_diag" so it survives process death.
 */
public final class DiagLog {

    private static final String TAG = "Rouse";
    private static final String KEY = "lines";
    private static final Object LOCK = new Object();
    private static final ArrayDeque<String> LINES = new ArrayDeque<>();
    private static SharedPreferences prefs;

    private DiagLog() {}

    public static void init(Context context) {
        synchronized (LOCK) {
            if (prefs != null) return;
            Context dp = NativePrefs.deviceContext(context);
            prefs = dp.getSharedPreferences(RouseConstants.DIAG_PREFS_NAME, Context.MODE_PRIVATE);
            String s = prefs.getString(KEY, null);
            if (s != null) {
                try {
                    JSONArray arr = new JSONArray(s);
                    for (int i = 0; i < arr.length(); i++) LINES.addLast(arr.optString(i));
                    while (LINES.size() > RouseConstants.DIAG_LOG_LINES) LINES.removeFirst();
                } catch (JSONException ignored) {
                    // corrupt buffer: start empty
                }
            }
        }
    }

    public static void i(String tag, String msg) {
        add("I", tag, msg);
        Log.i(TAG, tag + ": " + msg);
    }

    public static void w(String tag, String msg) {
        add("W", tag, msg);
        Log.w(TAG, tag + ": " + msg);
    }

    public static void e(String tag, String msg, Throwable t) {
        String full = t == null ? msg : msg + " (" + t.getClass().getSimpleName() + ": " + t.getMessage() + ")";
        add("E", tag, full);
        Log.e(TAG, tag + ": " + msg, t);
    }

    public static List<String> lines() {
        synchronized (LOCK) {
            return new ArrayList<>(LINES);
        }
    }

    private static void add(String level, String tag, String msg) {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        String line = fmt.format(new Date()) + " " + level + " " + tag + ": " + msg;
        synchronized (LOCK) {
            LINES.addLast(line);
            while (LINES.size() > RouseConstants.DIAG_LOG_LINES) LINES.removeFirst();
            if (prefs != null) {
                JSONArray arr = new JSONArray();
                for (String l : LINES) arr.put(l);
                prefs.edit().putString(KEY, arr.toString()).apply();
            }
        }
    }
}
