package app.rouse.alarm;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Capacitor plugin "Rouse" — the Java half of src/platform/native/RousePlugin.ts (frozen contract).
 * Thin: argument parsing + RingEngine calls (state thread) + result shaping. Errors are
 * call.reject(message, code) with code ∈ RousePluginErrorCode. Events use
 * notifyListeners(name, data, true).
 */
@CapacitorPlugin(
    name = "Rouse",
    permissions = {
        @Permission(alias = RousePlugin.ALIAS_NOTIFICATIONS, strings = { "android.permission.POST_NOTIFICATIONS" }),
        @Permission(alias = RousePlugin.ALIAS_CAMERA, strings = { Manifest.permission.CAMERA }),
    }
)
public class RousePlugin extends Plugin implements RingEngine.EventSink {

    static final String ALIAS_NOTIFICATIONS = "notifications";
    static final String ALIAS_CAMERA = "camera";

    private RingEngine engine;
    private SoundLibrary sounds;
    private SoundPreview preview;

    @Override
    public void load() {
        engine = RingEngine.get(getContext());
        sounds = new SoundLibrary(getContext());
        preview = new SoundPreview(getContext());
        engine.setEventSink(this);
        engine.reconcile("app-start");
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        emit("healthChanged", new JSONObject());
    }

    @Override
    protected void handleOnDestroy() {
        if (engine != null) engine.clearEventSink(this);
        if (preview != null) preview.stop();
        super.handleOnDestroy();
    }

    // ── RingEngine.EventSink ──

    @Override
    public void emit(final String eventName, JSONObject data) {
        final JSObject js = toJS(data);
        try {
            // Serialise with addListener/removeListener, which run on the bridge's plugin thread.
            execute(() -> notifyListeners(eventName, js, true));
        } catch (RuntimeException e) {
            DiagLog.e("plugin", "emit " + eventName + " failed", e);
        }
    }

    // ── helpers ──

    static JSObject toJS(JSONObject o) {
        if (o == null) return new JSObject();
        try {
            return JSObject.fromJSONObject(o);
        } catch (JSONException e) {
            return new JSObject();
        }
    }

    private static Long optLong(PluginCall call, String name) {
        Object v = call.getData().opt(name);
        if (v instanceof Number) return ((Number) v).longValue();
        return null;
    }

    private static boolean isInteger(PluginCall call, String name) {
        Object v = call.getData().opt(name);
        return v instanceof Number && ((Number) v).doubleValue() == Math.floor(((Number) v).doubleValue());
    }

    private void run(PluginCall call, RingEngine.Op<JSONObject> op) {
        try {
            JSONObject r = engine.call(op);
            if (r == null) call.resolve();
            else call.resolve(toJS(r));
        } catch (RouseError e) {
            call.reject(e.getMessage(), e.code);
        }
    }

    private static void invalid(PluginCall call, String message) {
        call.reject(message, RouseError.INVALID_ARGUMENT);
    }

    private static JSONObject single(String key, Object value) throws JSONException {
        JSONObject o = new JSONObject();
        o.put(key, value == null ? JSONObject.NULL : value);
        return o;
    }

    private String requireSession(PluginCall call) {
        String sid = call.getString("sessionId");
        if (sid == null || sid.isEmpty()) {
            invalid(call, "sessionId is required");
            return null;
        }
        return sid;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Plugin methods (names and shapes per RousePlugin.ts)
    // ─────────────────────────────────────────────────────────────────────────

    @PluginMethod
    public void syncAlarms(PluginCall call) {
        if (!isInteger(call, "mirrorVersion")) {
            invalid(call, "mirrorVersion is required");
            return;
        }
        final int mirrorVersion = optLong(call, "mirrorVersion").intValue();
        final JSONArray alarms = call.getArray("alarms");
        final JSONObject settings = call.getObject("settings");
        if (alarms == null) {
            invalid(call, "alarms must be an array");
            return;
        }
        run(call, () -> engine.syncAlarms(mirrorVersion, alarms, settings));
    }

    @PluginMethod
    public void getNextFire(PluginCall call) {
        run(call, () -> engine.getNextFire());
    }

    @PluginMethod
    public void getHealth(PluginCall call) {
        try {
            call.resolve(toJS(new HealthChecker(getContext()).evaluate()));
        } catch (JSONException | RuntimeException e) {
            DiagLog.e("plugin", "getHealth failed", e);
            call.reject("Health check failed", RouseError.IO_ERROR);
        }
    }

    @PluginMethod
    public void testAlarm(PluginCall call) {
        final JSONObject alarm = call.getObject("alarm");
        if (alarm == null || !isInteger(call, "delaySeconds")) {
            invalid(call, "alarm and integer delaySeconds are required");
            return;
        }
        final int delay = optLong(call, "delaySeconds").intValue();
        run(call, () -> single("fireAt", engine.testAlarm(alarm, delay)));
    }

    @PluginMethod
    public void getActiveRing(PluginCall call) {
        run(call, () -> engine.getActiveRing());
    }

    @PluginMethod
    public void missionUiReady(PluginCall call) {
        final String sid = requireSession(call);
        if (sid == null) return;
        run(call, () -> {
            engine.missionUiReady(sid);
            return null;
        });
    }

    @PluginMethod
    public void setSilenced(PluginCall call) {
        final String sid = requireSession(call);
        if (sid == null) return;
        final Boolean silenced = call.getBoolean("silenced");
        if (silenced == null) {
            invalid(call, "silenced must be a boolean");
            return;
        }
        Long lease = optLong(call, "leaseMs");
        final long leaseMs = lease == null ? 0L : Math.max(0L, lease);
        run(call, () -> {
            engine.setSilenced(sid, silenced, leaseMs);
            return null;
        });
    }

    @PluginMethod
    public void snooze(PluginCall call) {
        final String sid = requireSession(call);
        if (sid == null) return;
        run(call, () -> single("snoozeUntil", engine.snooze(sid)));
    }

    @PluginMethod
    public void dismiss(PluginCall call) {
        final String sid = requireSession(call);
        if (sid == null) return;
        final String via = call.getString("via");
        if (!"mission".equals(via) && !"fallback".equals(via) && !"no-mission".equals(via)) {
            invalid(call, "via must be mission | fallback | no-mission");
            return;
        }
        run(call, () -> single("wakeCheckAt", engine.dismiss(sid, via)));
    }

    @PluginMethod
    public void confirmAwake(PluginCall call) {
        final String sid = requireSession(call);
        if (sid == null) return;
        run(call, () -> {
            engine.confirmAwake(sid);
            return null;
        });
    }

    @PluginMethod
    public void getLog(PluginCall call) {
        Long after = optLong(call, "afterSeq");
        final long afterSeq = after == null ? 0L : after;
        run(call, () -> engine.getLog(afterSeq));
    }

    @PluginMethod
    public void ackLog(PluginCall call) {
        final Long through = optLong(call, "throughSeq");
        if (through == null) {
            invalid(call, "throughSeq is required");
            return;
        }
        run(call, () -> {
            engine.ackLog(through);
            return null;
        });
    }

    @PluginMethod
    public void listSounds(PluginCall call) {
        try {
            call.resolve(toJS(single("sounds", sounds.list())));
        } catch (JSONException e) {
            call.reject("Could not list sounds", RouseError.IO_ERROR);
        }
    }

    @PluginMethod
    public void previewSound(PluginCall call) {
        JSONObject sound = call.getObject("sound");
        Long volume = optLong(call, "volume");
        if (sound == null || volume == null) {
            invalid(call, "sound and volume are required");
            return;
        }
        String kind = sound.optString("kind", "");
        String id = sound.optString("id", "");
        if (!("bundled".equals(kind) || "custom".equals(kind)) || id.isEmpty()) {
            invalid(call, "sound must be a SoundRef");
            return;
        }
        if (RingService.isAliveAny()) {
            call.resolve(); // never fight a real ring for the alarm stream
            return;
        }
        final SoundLibrary.Source source = sounds.resolve(kind, id);
        final int percent = (int) Math.max(10L, Math.min(100L, volume));
        getBridge().executeOnMainThread(() -> preview.start(source, percent));
        call.resolve();
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        getBridge().executeOnMainThread(() -> preview.stop());
        call.resolve();
    }

    @PluginMethod
    public void pickCustomSound(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/*");
        startActivityForResult(call, intent, "pickSoundResult");
    }

    @ActivityCallback
    private void pickSoundResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            try {
                call.resolve(toJS(single("sound", null)));
            } catch (JSONException e) {
                call.resolve();
            }
            return;
        }
        final Uri uri = data.getData();
        execute(() -> {
            try {
                call.resolve(toJS(single("sound", sounds.importCustom(uri))));
            } catch (RouseError e) {
                call.reject(e.getMessage(), e.code);
            } catch (JSONException e) {
                call.reject("Could not save the sound", RouseError.IO_ERROR);
            }
        });
    }

    @PluginMethod
    public void deleteCustomSound(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            invalid(call, "id is required");
            return;
        }
        sounds.delete(id);
        call.resolve();
    }

    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        JSArray lines = new JSArray();
        for (String l : DiagLog.lines()) lines.put(l);
        JSObject o = new JSObject();
        o.put("lines", lines);
        call.resolve(o);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // requestFix
    // ─────────────────────────────────────────────────────────────────────────

    @PluginMethod
    public void requestFix(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            invalid(call, "id is required");
            return;
        }
        HealthChecker hc = new HealthChecker(getContext());
        String pkg = getContext().getPackageName();
        switch (id) {
            case "notifications":
                if (hc.notificationsOk()) {
                    outcome(call, "already-ok");
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    && !hc.notificationPermissionGranted()
                    && getPermissionState(ALIAS_NOTIFICATIONS) != PermissionState.DENIED) {
                    requestPermissionForAlias(ALIAS_NOTIFICATIONS, call, "notificationsPermissionCallback");
                } else {
                    openSettings(call, notificationSettingsIntent(pkg));
                }
                return;
            case "exactAlarm":
                if (hc.exactAlarmOk()) {
                    outcome(call, "already-ok");
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
                    openSettings(call, new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg)));
                } else {
                    outcome(call, "unsupported");
                }
                return;
            case "fullScreenIntent":
                if (hc.fullScreenIntentOk()) {
                    outcome(call, "already-ok");
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    openSettings(call, new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + pkg)));
                } else {
                    outcome(call, "unsupported");
                }
                return;
            case "batteryOptimization":
                if (hc.batteryOk()) outcome(call, "already-ok");
                else openSettings(call, batteryIntent(pkg));
                return;
            case "backgroundRestricted":
                if (hc.backgroundOk()) outcome(call, "already-ok");
                else openSettings(call, appDetailsIntent(pkg));
                return;
            case "alarmVolume":
                if (hc.volumeOk()) outcome(call, "already-ok");
                else openSettings(call, new Intent(Settings.ACTION_SOUND_SETTINGS));
                return;
            case "dndAllowsAlarms":
                if (Boolean.TRUE.equals(hc.dndOk())) outcome(call, "already-ok");
                else openSettings(call, new Intent("android.settings.ZEN_MODE_SETTINGS"));
                return;
            case "camera":
                if (hc.cameraGranted()) {
                    outcome(call, "already-ok");
                } else if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
                    outcome(call, "unsupported");
                } else if (getPermissionState(ALIAS_CAMERA) == PermissionState.DENIED) {
                    openSettings(call, appDetailsIntent(pkg));
                } else {
                    requestPermissionForAlias(ALIAS_CAMERA, call, "cameraPermissionCallback");
                }
                return;
            case "motionSensors":
            case "lockedDevice":
                outcome(call, "unsupported");
                return;
            default:
                invalid(call, "Unknown health check id");
        }
    }

    @PermissionCallback
    private void notificationsPermissionCallback(PluginCall call) {
        if (call == null) return;
        outcome(call, getPermissionState(ALIAS_NOTIFICATIONS) == PermissionState.GRANTED ? "granted" : "denied");
        emit("healthChanged", new JSONObject());
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (call == null) return;
        outcome(call, getPermissionState(ALIAS_CAMERA) == PermissionState.GRANTED ? "granted" : "denied");
        emit("healthChanged", new JSONObject());
    }

    private static void outcome(PluginCall call, String value) {
        JSObject o = new JSObject();
        o.put("outcome", value);
        call.resolve(o);
    }

    private static Intent appDetailsIntent(String pkg) {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
    }

    private static Intent notificationSettingsIntent(String pkg) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
            return i;
        }
        return appDetailsIntent(pkg);
    }

    @android.annotation.SuppressLint("BatteryLife")
    private static Intent batteryIntent(String pkg) {
        // Alarm clocks are an accepted use of this exemption request.
        return new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
    }

    /** Launch a settings screen; resolves 'settings-opened' (or falls back to app details / 'unsupported'). */
    private void openSettings(final PluginCall call, final Intent intent) {
        final Activity activity = getActivity();
        if (activity == null) {
            outcome(call, "unsupported");
            return;
        }
        final String pkg = getContext().getPackageName();
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(intent);
                outcome(call, "settings-opened");
            } catch (ActivityNotFoundException | SecurityException e) {
                try {
                    activity.startActivity(appDetailsIntent(pkg));
                    outcome(call, "settings-opened");
                } catch (ActivityNotFoundException | SecurityException e2) {
                    outcome(call, "unsupported");
                }
            }
        });
    }
}
