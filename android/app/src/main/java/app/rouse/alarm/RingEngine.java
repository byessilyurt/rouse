package app.rouse.alarm;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import app.rouse.alarm.model.AlarmSpec;
import app.rouse.alarm.model.Episode;
import app.rouse.alarm.store.EpisodeStore;
import app.rouse.alarm.store.LogStore;
import app.rouse.alarm.store.MirrorStore;
import app.rouse.alarm.store.NativePrefs;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The native alarm brain (plan §1.2, §3). Singleton; EVERY state transition runs on the single
 * HandlerThread "rouse-state" and is persisted (commit()) before anything audible happens.
 * Callers: RousePlugin (via call()), the receivers (via post() + goAsync), MainActivity,
 * FallbackMissionActivity and RingService.
 */
public final class RingEngine {

    /** Plugin event sink (RousePlugin): event name ∈ ring, wakeCheck, ringState, log, healthChanged. */
    public interface EventSink {
        void emit(String eventName, JSONObject data);
    }

    /** Main-thread UI hooks (MainActivity, FallbackMissionActivity). */
    public interface UiListener {
        /** Episode changed (null = ended). Called on the main thread. */
        void onEpisodeChanged(Episode episode);

        /** The readiness timer expired: show the native fallback. Return true if handled. */
        boolean onNativeFallbackRequested(String sessionId);
    }

    /** A unit of work run on the state thread that may fail with a plugin error. */
    public interface Op<T> {
        T run() throws RouseError, JSONException;
    }

    private static final long LEASE_TOLERANCE_MS = 250L;
    private static final long CALL_TIMEOUT_S = 10L;
    /** lastHandledFireAt may legitimately be slightly ahead of now (early delivery, D-046). */
    private static final long CLOCK_BACK_TOLERANCE_MS = 60_000L;
    private static volatile RingEngine instance;

    private final Context app;
    private final Handler handler;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final MirrorStore mirror;
    private final EpisodeStore episodes;
    private final LogStore log;
    private final AlarmScheduler scheduler;
    private final CopyOnWriteArrayList<UiListener> uiListeners = new CopyOnWriteArrayList<>();
    private volatile EventSink sink;
    private volatile Episode snapshot;
    /** Session for which JS called missionUiReady in THIS process (cleared on fresh rings). */
    private volatile String memUiReadySession;
    private boolean logDirty;

    private final Runnable readinessTimeout = () -> guarded(this::onReadinessTimeout);
    private final Runnable silenceExpiry = () -> guarded(this::onSilenceTimer);

    public static RingEngine get(Context context) {
        RingEngine e = instance;
        if (e == null) {
            synchronized (RingEngine.class) {
                e = instance;
                if (e == null) {
                    e = new RingEngine(context);
                    instance = e;
                }
            }
        }
        return e;
    }

    private RingEngine(Context context) {
        this.app = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        DiagLog.init(app);
        this.mirror = new MirrorStore(NativePrefs.get(app));
        this.episodes = new EpisodeStore(NativePrefs.get(app));
        this.log = new LogStore(NativePrefs.get(app));
        this.scheduler = new AlarmScheduler(app);
        HandlerThread thread = new HandlerThread("rouse-state");
        thread.start();
        this.handler = new Handler(thread.getLooper());
        Episode e = episodes.get();
        this.snapshot = e == null ? null : e.copy();
        Notifications.ensureChannels(app);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Threading
    // ─────────────────────────────────────────────────────────────────────────

    /** Run on the state thread (fire and forget). Exceptions are logged, never crash the app. */
    public void post(Runnable r) {
        handler.post(() -> guarded(r));
    }

    private void guarded(Runnable r) {
        try {
            r.run();
        } catch (RuntimeException ex) {
            DiagLog.e("engine", "task failed", ex);
        } finally {
            flushLog();
        }
    }

    /** Run on the state thread and wait for the result (plugin methods). */
    public <T> T call(Op<T> op) throws RouseError {
        if (Looper.myLooper() == handler.getLooper()) {
            try {
                return op.run();
            } catch (JSONException e) {
                throw new RouseError(RouseError.INVALID_ARGUMENT, e.getMessage());
            } finally {
                flushLog();
            }
        }
        final Object[] result = new Object[1];
        final Throwable[] error = new Throwable[1];
        final CountDownLatch latch = new CountDownLatch(1);
        handler.post(() -> {
            try {
                result[0] = op.run();
            } catch (Throwable t) {
                error[0] = t;
            } finally {
                flushLog();
                latch.countDown();
            }
        });
        try {
            if (!latch.await(CALL_TIMEOUT_S, TimeUnit.SECONDS)) {
                throw new RouseError(RouseError.IO_ERROR, "Native state thread timed out");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RouseError(RouseError.IO_ERROR, "Interrupted");
        }
        Throwable t = error[0];
        if (t instanceof RouseError) throw (RouseError) t;
        if (t instanceof JSONException) throw new RouseError(RouseError.INVALID_ARGUMENT, t.getMessage());
        if (t != null) {
            DiagLog.e("engine", "call failed", t);
            throw new RouseError(RouseError.IO_ERROR, t.getClass().getSimpleName() + ": " + t.getMessage());
        }
        @SuppressWarnings("unchecked")
        T r = (T) result[0];
        return r;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Listeners / events
    // ─────────────────────────────────────────────────────────────────────────

    public void setEventSink(EventSink s) {
        this.sink = s;
    }

    public void clearEventSink(EventSink s) {
        if (this.sink == s) this.sink = null;
    }

    public void addUiListener(UiListener l) {
        uiListeners.addIfAbsent(l);
    }

    public void removeUiListener(UiListener l) {
        uiListeners.remove(l);
    }

    /** Last persisted episode (copy; do not mutate). Safe from any thread. */
    public Episode snapshot() {
        return snapshot;
    }

    private void emit(String name, JSONObject data) {
        EventSink s = sink;
        if (s == null) return;
        try {
            s.emit(name, data);
        } catch (RuntimeException ex) {
            DiagLog.e("engine", "emit " + name + " failed", ex);
        }
    }

    private static JSONObject wrapRing(Episode e) {
        JSONObject o = new JSONObject();
        try {
            o.put("ring", e == null ? JSONObject.NULL : e.toActiveRingJson());
        } catch (JSONException ex) {
            throw new IllegalStateException(ex);
        }
        return o;
    }

    private void emitRing(Episode e) {
        emit("ring", wrapRing(e));
    }

    private void emitWakeCheck(Episode e) {
        emit("wakeCheck", wrapRing(e));
    }

    private void emitRingState(Episode eOrNull) {
        emit("ringState", wrapRing(eOrNull));
    }

    public void emitHealthChanged() {
        emit("healthChanged", new JSONObject());
    }

    private void flushLog() {
        if (!logDirty) return;
        logDirty = false;
        JSONObject o = new JSONObject();
        try {
            o.put("lastSeq", log.lastSeq());
        } catch (JSONException ex) {
            return;
        }
        emit("log", o);
    }

    /** Append a durable log event. Test episodes write NO log events (D-030). */
    private void logEvent(Episode e, String type, String alarmId, JSONObject fields) {
        if (e != null && e.isTest) return;
        String sid = e == null ? UUID.randomUUID().toString() : e.sessionId;
        log.append(type, now(), sid, alarmId, fields);
        logDirty = true;
        DiagLog.i("log", type);
    }

    private static JSONObject fields(Object... kv) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < kv.length; i += 2) {
                Object v = kv[i + 1];
                o.put((String) kv[i], v == null ? JSONObject.NULL : v);
            }
        } catch (JSONException ex) {
            throw new IllegalStateException(ex);
        }
        return o;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Persistence helpers
    // ─────────────────────────────────────────────────────────────────────────

    private static long now() {
        return System.currentTimeMillis();
    }

    private static ZoneId zone() {
        return ZoneId.systemDefault();
    }

    private void saveEpisode(Episode e) {
        if (!episodes.put(e)) DiagLog.w("engine", "episode commit failed");
        snapshot = e.copy();
        notifyUi();
    }

    private void clearEpisode() {
        episodes.clear();
        snapshot = null;
        memUiReadySession = null;
        handler.removeCallbacks(readinessTimeout);
        handler.removeCallbacks(silenceExpiry);
        notifyUi();
    }

    private void notifyUi() {
        final Episode s = snapshot;
        main.post(() -> {
            for (UiListener l : uiListeners) {
                try {
                    l.onEpisodeChanged(s);
                } catch (RuntimeException ex) {
                    DiagLog.e("engine", "ui listener failed", ex);
                }
            }
        });
    }

    private Episode requireEpisode(String sessionId, String... states) throws RouseError {
        Episode e = episodes.get();
        if (e == null) throw new RouseError(RouseError.NO_ACTIVE_RING, "No active ring");
        if (sessionId == null || !sessionId.equals(e.sessionId)) {
            throw new RouseError(RouseError.SESSION_MISMATCH, "sessionId is not the current episode");
        }
        for (String s : states) {
            if (s.equals(e.state)) return e;
        }
        throw new RouseError(RouseError.NO_ACTIVE_RING, "Episode is " + e.state);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ring service control
    // ─────────────────────────────────────────────────────────────────────────

    private void startRingService(Episode e) {
        Intent i = new Intent(app, RingService.class);
        i.setAction(RouseConstants.ACTION_RING);
        i.putExtra(RouseConstants.EXTRA_SESSION_ID, e.sessionId);
        try {
            ContextCompat.startForegroundService(app, i);
        } catch (RuntimeException ex) {
            // e.g. ForegroundServiceStartNotAllowedException: still show the full-screen notification;
            // MainActivity restarts the service from the foreground (ringUiLaunched).
            DiagLog.e("engine", "startForegroundService failed", ex);
            Notifications.post(app, RouseConstants.NOTIF_RING, Notifications.buildRing(app, e));
        }
    }

    /**
     * Open the ring screen directly when "Display over other apps" allows a background activity
     * start: the full-screen intent alone shows only a banner while the phone is in use. The
     * notification's full-screen intent stays as the path without the permission.
     */
    private void launchRingUi(Episode e) {
        if (!HealthChecker.overlayAllowed(app)) return;
        try {
            app.startActivity(Notifications.ringUiActivityIntent(app, e));
        } catch (RuntimeException ex) {
            DiagLog.e("engine", "direct ring UI launch failed; full-screen notification remains", ex);
        }
    }

    private void stopRingService() {
        try {
            app.stopService(new Intent(app, RingService.class));
        } catch (RuntimeException ex) {
            DiagLog.e("engine", "stopService failed", ex);
        }
        Notifications.cancel(app, RouseConstants.NOTIF_RING);
        // If no service instance is running in this process (FGS start was refused, or the process
        // was restarted mid-ring), nobody else will put the user's alarm volume back.
        main.post(() -> {
            if (RingService.current() == null) VolumeLock.restoreSaved(app);
        });
    }

    private void applySilenceToService(final boolean silenced) {
        main.post(() -> {
            RingService s = RingService.current();
            if (s != null) s.setSilenced(silenced);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scheduling
    // ─────────────────────────────────────────────────────────────────────────

    /** Recompute and arm RC_MAIN and the bedtime reminder from the mirror. Returns the SyncResult JSON. */
    private JSONObject rescheduleMain() throws JSONException {
        long now = now();
        long from = Math.max(now, mirror.lastHandledFireAt());
        ZoneId z = zone();
        List<AlarmSpec> alarms = mirror.readAlarms();

        ScheduleMath.NextFire nf = ScheduleMath.nextFire(alarms, from, z);
        if (nf != null) scheduler.scheduleMain(nf.fireAt, nf.alarmIds);
        else scheduler.cancel(RouseConstants.RC_MAIN);

        JSONObject settings = mirror.readSettings();
        JSONObject bt = settings.optJSONObject("bedtimeReminder");
        boolean btEnabled = bt != null && bt.optBoolean("enabled", false);
        int goal = bt == null ? 480 : bt.optInt("sleepGoalMin", 480);
        List<AlarmSpec> nonNap = new ArrayList<>();
        for (AlarmSpec a : alarms) {
            if (!a.deleteAfterRing) nonNap.add(a);
        }
        Long bedtime = ScheduleMath.bedtimeReminderAt(nonNap, btEnabled, goal, now, z);
        if (bedtime != null && bedtime <= mirror.lastBedtimeAt()) bedtime = null;
        if (bedtime != null) scheduler.scheduleBedtime(bedtime);
        else scheduler.cancel(RouseConstants.RC_BEDTIME);

        JSONObject next = null;
        JSONArray ids = new JSONArray();
        if (nf != null) {
            for (String id : nf.alarmIds) ids.put(id);
            next = new JSONObject();
            next.put("alarmId", nf.alarmId);
            next.put("alarmIds", ids);
            next.put("fireAt", nf.fireAt);
        }
        JSONObject scheduled = new JSONObject();
        scheduled.put("fireAt", nf == null ? JSONObject.NULL : (Object) nf.fireAt);
        scheduled.put("alarmId", nf == null ? JSONObject.NULL : nf.alarmId);
        scheduled.put("alarmIds", ids);
        scheduled.put("bedtimeAt", bedtime == null ? JSONObject.NULL : (Object) bedtime);
        mirror.writeScheduled(scheduled);

        JSONArray per = new JSONArray();
        for (AlarmSpec a : alarms) {
            Long t = a.enabled ? ScheduleMath.nextOccurrence(a, from, z) : null;
            JSONObject info = new JSONObject();
            info.put("alarmId", a.id);
            info.put("nextFireAt", t == null ? JSONObject.NULL : (Object) t);
            per.put(info);
        }
        JSONObject result = new JSONObject();
        result.put("next", next == null ? JSONObject.NULL : next);
        result.put("alarms", per);
        result.put("bedtimeReminderAt", bedtime == null ? JSONObject.NULL : (Object) bedtime);
        DiagLog.i("engine", "scheduled main=" + (nf == null ? "none" : String.valueOf(nf.fireAt)) + " alarms=" + alarms.size());
        return result;
    }

    private void rescheduleQuietly() {
        try {
            rescheduleMain();
        } catch (JSONException ex) {
            DiagLog.e("engine", "reschedule failed", ex);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Plugin operations (call on the state thread via call())
    // ─────────────────────────────────────────────────────────────────────────

    public JSONObject syncAlarms(int mirrorVersion, JSONArray alarms, JSONObject settings) throws RouseError, JSONException {
        if (mirrorVersion < 1 || mirrorVersion > RouseConstants.NATIVE_MIRROR_VERSION) {
            throw new RouseError(RouseError.INVALID_ARGUMENT, "Unsupported mirrorVersion " + mirrorVersion);
        }
        if (alarms == null) throw new RouseError(RouseError.INVALID_ARGUMENT, "alarms missing");
        JSONArray clean = new JSONArray();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject o = alarms.optJSONObject(i);
            if (o == null) throw new RouseError(RouseError.INVALID_ARGUMENT, "alarms[" + i + "] is not an object");
            try {
                AlarmSpec.fromJson(o);
            } catch (JSONException ex) {
                throw new RouseError(RouseError.INVALID_ARGUMENT, "alarms[" + i + "]: " + ex.getMessage());
            }
            clean.put(new JSONObject(o.toString()));
        }
        JSONObject m = new JSONObject();
        m.put("mirrorVersion", mirrorVersion);
        m.put("syncedAt", now());
        m.put("alarms", clean);
        m.put("settings", settings == null ? new JSONObject() : new JSONObject(settings.toString()));
        if (!mirror.writeMirror(m)) throw new RouseError(RouseError.IO_ERROR, "Could not persist the alarm mirror");
        return rescheduleMain();
    }

    public JSONObject getNextFire() throws JSONException {
        JSONObject s = mirror.readScheduled();
        JSONObject out = new JSONObject();
        Long fireAt = s == null ? null : AlarmSpec.optNullableLong(s, "fireAt");
        if (fireAt == null) {
            out.put("next", JSONObject.NULL);
            return out;
        }
        JSONObject next = new JSONObject();
        JSONArray ids = s.optJSONArray("alarmIds");
        if (ids == null) ids = new JSONArray();
        String alarmId = s.isNull("alarmId") ? ids.optString(0, "") : s.optString("alarmId", ids.optString(0, ""));
        next.put("alarmId", alarmId);
        next.put("alarmIds", ids);
        next.put("fireAt", fireAt.longValue());
        out.put("next", next);
        return out;
    }

    public JSONObject getActiveRing() throws JSONException {
        Episode e = episodes.get();
        return wrapRing(e);
    }

    public long testAlarm(JSONObject alarmJson, int delaySeconds) throws RouseError, JSONException {
        if (delaySeconds < 1 || delaySeconds > 3600) {
            throw new RouseError(RouseError.INVALID_ARGUMENT, "delaySeconds must be 1..3600");
        }
        AlarmSpec a;
        try {
            a = AlarmSpec.fromJson(alarmJson);
        } catch (JSONException ex) {
            throw new RouseError(RouseError.INVALID_ARGUMENT, "alarm: " + ex.getMessage());
        }
        long fireAt = now() + delaySeconds * 1000L;
        JSONObject pending = new JSONObject();
        pending.put("fireAt", fireAt);
        pending.put("alarm", a.toJson());
        if (!mirror.setPendingTest(pending)) throw new RouseError(RouseError.IO_ERROR, "Could not persist the test alarm");
        scheduler.schedule(RouseConstants.RC_TEST, fireAt);
        DiagLog.i("engine", "test alarm in " + delaySeconds + " s");
        return fireAt;
    }

    /** { "fireAt": ms | null }: the test ring that has not fired yet. One older than the grace period reads as none. */
    public JSONObject getPendingTest() throws JSONException {
        JSONObject pending = mirror.pendingTest();
        long at = pending == null ? 0L : pending.optLong("fireAt", 0L);
        boolean live = pending != null && at > 0L && now() - at <= RouseConstants.MISSED_GRACE_MS;
        JSONObject out = new JSONObject();
        out.put("fireAt", live ? (Object) at : JSONObject.NULL);
        return out;
    }

    /**
     * Cancel a pending test and end a running test ring the way dismiss does for tests: no log events,
     * no wake check, volume restored (D-030, D-053). A real episode is never touched.
     */
    public void cancelTest() {
        scheduler.cancel(RouseConstants.RC_TEST);
        boolean hadPending = mirror.pendingTest() != null;
        mirror.setPendingTest(null);
        Episode e = episodes.get();
        boolean endedRing = false;
        if (e != null && e.isTest) {
            try {
                dismiss(e.sessionId, "no-mission");
            } catch (RouseError ex) {
                // Not ringing/snoozed (should not happen for a test): drop it so nothing is left audible.
                DiagLog.w("engine", "test episode in " + e.state + "; clearing");
                scheduler.cancel(RouseConstants.RC_SAFETY);
                stopRingService();
                clearEpisode();
                emitRingState(null);
            }
            endedRing = true;
        }
        DiagLog.i("engine", "test cancelled pending=" + hadPending + " ring=" + endedRing);
    }

    public void missionUiReady(String sessionId) throws RouseError {
        Episode e = requireEpisode(sessionId, Episode.STATE_RINGING, Episode.STATE_SNOOZED);
        // Snoozed ("I'm up — turn it off", design §3.9): nothing rings, no readiness timer to cancel.
        if (!e.isRinging()) return;
        memUiReadySession = sessionId;
        handler.removeCallbacks(readinessTimeout);
        if (!e.uiReady) {
            e.uiReady = true;
            saveEpisode(e);
        }
    }

    public void setSilenced(String sessionId, boolean silenced, long leaseMs) throws RouseError {
        Episode e = requireEpisode(sessionId, Episode.STATE_RINGING, Episode.STATE_SNOOZED);
        // Snoozed: nothing is audible, so there is nothing to silence (harmless no-op, design §3.9).
        if (!e.isRinging()) return;
        boolean was = e.silenced;
        if (silenced && leaseMs > 0) {
            long lease = Math.min(leaseMs, RouseConstants.MAX_SILENCE_LEASE_MS);
            e.silenced = true;
            e.silenceUntil = now() + lease;
            saveEpisode(e);
            handler.removeCallbacks(silenceExpiry);
            handler.postDelayed(silenceExpiry, lease);
            applySilenceToService(true);
        } else {
            e.silenced = false;
            e.silenceUntil = null;
            saveEpisode(e);
            handler.removeCallbacks(silenceExpiry);
            applySilenceToService(false);
        }
        if (was != e.silenced) emitRingState(e);
    }

    public long snooze(String sessionId) throws RouseError {
        Episode e = requireEpisode(sessionId, Episode.STATE_RINGING);
        if (!e.alarm.snoozeEnabled) throw new RouseError(RouseError.SNOOZE_NOT_ALLOWED, "Snooze is off for this alarm");
        if (Episode.SOURCE_WAKE_CHECK.equals(e.source)) {
            throw new RouseError(RouseError.SNOOZE_NOT_ALLOWED, "No snooze on a wake-up check re-ring");
        }
        if (e.snoozeCount >= e.alarm.snoozeMaxCount) throw new RouseError(RouseError.SNOOZE_NOT_ALLOWED, "No snoozes left");

        long now = now();
        stopRingService();
        scheduler.cancel(RouseConstants.RC_SAFETY);
        handler.removeCallbacks(readinessTimeout);
        handler.removeCallbacks(silenceExpiry);
        memUiReadySession = null;

        e.snoozeCount++;
        e.snoozeUntil = now + e.alarm.snoozeIntervalMin * 60_000L;
        e.state = Episode.STATE_SNOOZED;
        e.ringStartedAt = null;
        e.silenced = false;
        e.silenceUntil = null;
        e.uiReady = false;
        e.ringUiLaunchedAt = null;
        saveEpisode(e);
        scheduler.schedule(RouseConstants.RC_SNOOZE, e.snoozeUntil);
        logEvent(e, "snoozed", e.alarmId, fields("snoozeCount", e.snoozeCount, "snoozeUntil", e.snoozeUntil));
        Notifications.postSnoozed(app, e);
        emitRingState(e);
        return e.snoozeUntil;
    }

    /**
     * via ∈ mission | fallback | no-mission (JS) or native-fallback (FallbackMissionActivity).
     * Valid while 'ringing' or 'snoozed' (design §3.9 "I'm up — turn it off": the missions are
     * solved during the snooze; the pending RC_SNOOZE is cancelled and the dismiss proceeds normally).
     */
    public Long dismiss(String sessionId, String via) throws RouseError {
        Episode e = requireEpisode(sessionId, Episode.STATE_RINGING, Episode.STATE_SNOOZED);
        long now = now();
        if (Episode.STATE_SNOOZED.equals(e.state)) {
            scheduler.cancel(RouseConstants.RC_SNOOZE);
            e.snoozeUntil = null;
        }
        stopRingService();
        scheduler.cancel(RouseConstants.RC_SAFETY);
        handler.removeCallbacks(readinessTimeout);
        handler.removeCallbacks(silenceExpiry);
        memUiReadySession = null;
        Notifications.cancel(app, RouseConstants.NOTIF_STATUS);

        if (e.alarm.wakeCheckEnabled && !e.isTest && e.wakeCheckReRings < RouseConstants.WAKE_CHECK_MAX_RERINGS) {
            long at = now + e.alarm.wakeCheckDelayMin * 60_000L;
            e.state = Episode.STATE_WAKE_CHECK_WAIT;
            e.wakeCheckAt = at;
            e.ringStartedAt = null;
            e.silenced = false;
            e.silenceUntil = null;
            e.uiReady = false;
            e.ringUiLaunchedAt = null;
            saveEpisode(e);
            scheduler.schedule(RouseConstants.RC_WAKE_CHECK, at);
            logEvent(e, "dismissed", e.alarmId, fields("via", via, "wakeCheckAt", at));
            emitRingState(e);
            DiagLog.i("engine", "dismissed via " + via + "; wake check pending");
            return at;
        }
        logEvent(e, "dismissed", e.alarmId, fields("via", via, "wakeCheckAt", null));
        logEvent(e, "episode-ended", e.alarmId, fields("reason", "dismissed"));
        clearEpisode();
        emitRingState(null);
        DiagLog.i("engine", "dismissed via " + via + "; episode ended");
        return null;
    }

    public void confirmAwake(String sessionId) throws RouseError {
        Episode e = requireEpisode(sessionId, Episode.STATE_WAKE_CHECK_WAIT, Episode.STATE_WAKE_CHECK_PROMPT);
        scheduler.cancel(RouseConstants.RC_WAKE_CHECK);
        scheduler.cancel(RouseConstants.RC_WAKE_DEADLINE);
        Notifications.cancel(app, RouseConstants.NOTIF_WAKE_CHECK);
        logEvent(e, "wake-check-confirmed", e.alarmId, null);
        logEvent(e, "episode-ended", e.alarmId, fields("reason", "wake-check-confirmed"));
        clearEpisode();
        emitRingState(null);
    }

    public JSONObject getLog(long afterSeq) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("events", log.after(afterSeq));
        o.put("lastSeq", log.lastSeq());
        return o;
    }

    public void ackLog(long throughSeq) {
        log.ack(throughSeq);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UI hooks (async; called from the main thread)
    // ─────────────────────────────────────────────────────────────────────────

    /** MainActivity got a ring intent: (re)start the service if needed and arm the readiness timer. */
    public void ringUiLaunched(final String sessionId) {
        post(() -> {
            Episode e = episodes.get();
            if (e == null || !e.isRinging() || !e.sessionId.equals(sessionId)) return;
            if (!RingService.isAlive(sessionId)) {
                // The activity is in the foreground, so starting the FGS is allowed here.
                startRingService(e);
            }
            if (sessionId.equals(memUiReadySession) || e.nativeFallbackShown) return;
            e.ringUiLaunchedAt = now();
            saveEpisode(e);
            handler.removeCallbacks(readinessTimeout);
            handler.postDelayed(readinessTimeout, RouseConstants.NATIVE_UI_READY_TIMEOUT_MS);
        });
    }

    /**
     * A ring activity (MainActivity / FallbackMissionActivity) is RESUMED, i.e. visibly in the
     * foreground: if the episode is ringing but the service is not running (e.g. the FGS start from
     * the receiver was refused, D-051, or ringUiLaunched ran while the activity was not yet
     * visible), start it now, when an FGS start is certainly allowed.
     */
    public void ensureRingServiceFromForeground() {
        post(() -> {
            Episode e = episodes.get();
            if (e == null || !e.isRinging() || RingService.isAlive(e.sessionId)) return;
            DiagLog.w("engine", "ringing but service not alive; starting from foreground activity");
            startRingService(e);
        });
    }

    /** FallbackMissionActivity is on screen. */
    public void nativeFallbackShown(final String sessionId) {
        post(() -> {
            Episode e = episodes.get();
            if (e == null || !e.isRinging() || !e.sessionId.equals(sessionId) || e.nativeFallbackShown) return;
            e.nativeFallbackShown = true;
            saveEpisode(e);
            emitRingState(e);
        });
    }

    /** FallbackMissionActivity solved all problems. */
    public void dismissFromNativeFallback(final String sessionId) {
        post(() -> {
            try {
                dismiss(sessionId, "native-fallback");
            } catch (RouseError ex) {
                DiagLog.w("engine", "native fallback dismiss ignored: " + ex.code);
            }
        });
    }

    private void onReadinessTimeout() {
        Episode e = episodes.get();
        if (e == null || !e.isRinging()) return;
        if (e.sessionId.equals(memUiReadySession) || e.nativeFallbackShown) return;
        DiagLog.w("engine", "mission UI not ready after " + RouseConstants.NATIVE_UI_READY_TIMEOUT_MS + " ms; native fallback");
        e.nativeFallbackShown = true;
        saveEpisode(e);
        emitRingState(e);
        final String sid = e.sessionId;
        main.post(() -> {
            RingService s = RingService.current();
            if (s != null) s.refreshNotification();
            boolean handled = false;
            for (UiListener l : uiListeners) {
                try {
                    if (l.onNativeFallbackRequested(sid)) handled = true;
                } catch (RuntimeException ex) {
                    DiagLog.e("engine", "fallback listener failed", ex);
                }
            }
            if (!handled) startFallbackActivity(sid);
        });
    }

    private void startFallbackActivity(String sessionId) {
        Intent i = new Intent(app, FallbackMissionActivity.class);
        i.putExtra(RouseConstants.EXTRA_SESSION_ID, sessionId);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            app.startActivity(i);
        } catch (RuntimeException ex) {
            DiagLog.e("engine", "fallback activity launch blocked; notification FSI targets it", ex);
        }
    }

    private void onSilenceTimer() {
        Episode e = episodes.get();
        if (e == null || !e.isRinging() || !e.silenced) return;
        long now = now();
        if (e.silenceUntil != null && e.silenceUntil > now + LEASE_TOLERANCE_MS) {
            handler.postDelayed(silenceExpiry, e.silenceUntil - now);
            return;
        }
        expireSilence(e);
    }

    /** Lease expired: resume at full gain, no ramp (D-017 fails loud). */
    private void expireSilence(Episode e) {
        e.silenced = false;
        e.silenceUntil = null;
        saveEpisode(e);
        applySilenceToService(false);
        emitRingState(e);
        DiagLog.i("engine", "silence lease expired; loud");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AlarmManager entry points (AlarmReceiver → post)
    // ─────────────────────────────────────────────────────────────────────────

    public void onAlarm(String action, long fireAtExtra) {
        if (action == null) return;
        DiagLog.i("alarm", action.substring(action.lastIndexOf('.') + 1));
        switch (action) {
            case RouseConstants.ACTION_FIRE:
                handleDue(fireAtExtra, Episode.SOURCE_SCHEDULED);
                break;
            case RouseConstants.ACTION_SNOOZE_END:
                onSnoozeEnd();
                break;
            case RouseConstants.ACTION_SAFETY:
                onSafety();
                break;
            case RouseConstants.ACTION_WAKE_CHECK:
                onWakeCheck();
                break;
            case RouseConstants.ACTION_WAKE_DEADLINE:
                onWakeDeadline();
                break;
            case RouseConstants.ACTION_TEST:
                onTestFire();
                break;
            case RouseConstants.ACTION_DEFERRED_START:
                onDeferredStart();
                break;
            case RouseConstants.ACTION_BEDTIME:
                onBedtime(fireAtExtra);
                break;
            default:
                DiagLog.w("alarm", "unknown action");
        }
    }

    /** A main fire (or a catch-up): flow B in plan §1.2. */
    private void handleDue(long fireAt, String source) {
        long now = now();
        if (fireAt <= 0) {
            JSONObject s = mirror.readScheduled();
            Long f = s == null ? null : AlarmSpec.optNullableLong(s, "fireAt");
            if (f == null) {
                rescheduleQuietly();
                return;
            }
            fireAt = f;
        }
        if (fireAt <= mirror.lastHandledFireAt()) {
            DiagLog.i("engine", "fire already handled");
            rescheduleQuietly();
            return;
        }
        mirror.setLastHandledFireAt(fireAt);
        Long pending = mirror.pendingCatchUp();
        if (pending != null && pending <= fireAt) mirror.setPendingCatchUp(null);

        List<AlarmSpec> all = mirror.readAlarms();
        List<ScheduleMath.Schedulable> dueRaw = ScheduleMath.dueAt(all, fireAt, zone());
        List<AlarmSpec> due = new ArrayList<>();
        for (ScheduleMath.Schedulable s : dueRaw) due.add((AlarmSpec) s);
        if (due.isEmpty()) {
            DiagLog.i("engine", "stale fire: nothing due");
            rescheduleQuietly();
            return;
        }
        if (now - fireAt > RouseConstants.MISSED_GRACE_MS) {
            for (AlarmSpec a : due) logEvent(null, "missed", a.id, fields("scheduledFor", fireAt));
            rescheduleQuietly();
            return;
        }

        Episode existing = episodes.get();
        CollisionPolicy.Decision d = CollisionPolicy.decide(existing, false);
        if (d == CollisionPolicy.Decision.MERGE_INTO_RINGING) {
            for (AlarmSpec a : due) {
                logEvent(existing, "merged", a.id, fields("ringingAlarmId", existing.alarmId));
                consumeOneOff(existing, a);
            }
            rescheduleQuietly();
            return;
        }

        String sid = UUID.randomUUID().toString();
        if (existing != null) supersede(existing, sid);

        AlarmSpec primary = due.get(0);
        Episode e = new Episode();
        e.sessionId = sid;
        e.alarmId = primary.id;
        e.alarm = primary;
        e.source = source;
        e.state = Episode.STATE_RINGING;
        e.scheduledFor = fireAt;
        e.episodeStartedAt = now;
        e.ringStartedAt = now;
        e.isTest = false;
        memUiReadySession = null;
        saveEpisode(e); // persisted BEFORE anything is audible
        try {
            scheduler.schedule(RouseConstants.RC_SAFETY, now + RouseConstants.SAFETY_RERING_INTERVAL_MS);
            logEvent(e, "ring-started", e.alarmId, fields("source", source, "scheduledFor", fireAt));
            for (int i = 1; i < due.size(); i++) {
                logEvent(e, "merged", due.get(i).id, fields("ringingAlarmId", primary.id));
            }
            for (AlarmSpec a : due) consumeOneOff(e, a);
            rescheduleQuietly();
        } finally {
            // Whatever failed above (logged by guarded()), the persisted episode MUST become audible now.
            startRingService(e);
            launchRingUi(e);
            emitRing(e);
        }
    }

    /** A one-off alarm that fired is disabled in the mirror; JS disables/deletes it on the log event. */
    private void consumeOneOff(Episode e, AlarmSpec a) {
        if (!a.isOneOff() || !a.enabled) return;
        mirror.replaceAlarm(a.withEnabled(false));
        logEvent(e, "one-off-consumed", a.id, null);
    }

    /** End `old` because a new alarm fired (D-014). Does not stop the ring service (the new ring reuses it). */
    private void supersede(Episode old, String bySessionId) {
        scheduler.cancel(RouseConstants.RC_SNOOZE);
        scheduler.cancel(RouseConstants.RC_SAFETY);
        scheduler.cancel(RouseConstants.RC_WAKE_CHECK);
        scheduler.cancel(RouseConstants.RC_WAKE_DEADLINE);
        Notifications.cancel(app, RouseConstants.NOTIF_WAKE_CHECK);
        Notifications.cancel(app, RouseConstants.NOTIF_STATUS);
        handler.removeCallbacks(readinessTimeout);
        handler.removeCallbacks(silenceExpiry);
        logEvent(old, "superseded", old.alarmId, fields("bySessionId", bySessionId));
        logEvent(old, "episode-ended", old.alarmId, fields("reason", "superseded"));
        DiagLog.i("engine", "episode superseded (test=" + old.isTest + ")");
    }

    /** Ring again within the same episode (snooze return, safety, wake-check re-ring). */
    private void reRing(Episode e, String source) {
        long now = now();
        boolean keepUiReady = Episode.SOURCE_SAFETY.equals(source) && e.isRinging();
        e.state = Episode.STATE_RINGING;
        e.source = source;
        e.ringStartedAt = now;
        e.snoozeUntil = null;
        e.wakeCheckAt = null;
        e.wakeCheckDeadlineAt = null;
        e.silenced = false; // a re-ring always starts loud
        e.silenceUntil = null;
        if (!keepUiReady) {
            e.uiReady = false;
            e.ringUiLaunchedAt = null;
            memUiReadySession = null;
        }
        saveEpisode(e);
        handler.removeCallbacks(silenceExpiry);
        try {
            scheduler.schedule(RouseConstants.RC_SAFETY, now + RouseConstants.SAFETY_RERING_INTERVAL_MS);
            Notifications.cancel(app, RouseConstants.NOTIF_STATUS);
            Notifications.cancel(app, RouseConstants.NOTIF_WAKE_CHECK);
            logEvent(e, "ring-started", e.alarmId, fields("source", source, "scheduledFor", e.scheduledFor));
        } finally {
            startRingService(e);
            launchRingUi(e);
            emitRing(e);
        }
    }

    private void onSnoozeEnd() {
        Episode e = episodes.get();
        if (e == null || !Episode.STATE_SNOOZED.equals(e.state)) return;
        reRing(e, Episode.SOURCE_SNOOZE);
    }

    private void onSafety() {
        Episode e = episodes.get();
        if (e == null || !e.isRinging()) return;
        long now = now();
        if (RingService.isAlive(e.sessionId)) {
            scheduler.schedule(RouseConstants.RC_SAFETY, now + RouseConstants.SAFETY_RERING_INTERVAL_MS);
            if (e.silenced && (e.silenceUntil == null || e.silenceUntil <= now + LEASE_TOLERANCE_MS)) expireSilence(e);
            main.post(() -> {
                RingService s = RingService.current();
                if (s != null) s.refreshWakeLock();
            });
        } else {
            DiagLog.w("engine", "safety: ring service dead; re-ringing");
            reRing(e, Episode.SOURCE_SAFETY);
        }
    }

    private void onWakeCheck() {
        Episode e = episodes.get();
        if (e == null || !Episode.STATE_WAKE_CHECK_WAIT.equals(e.state)) return;
        long deadline = now() + e.alarm.wakeCheckWindowMin * 60_000L;
        e.state = Episode.STATE_WAKE_CHECK_PROMPT;
        e.wakeCheckAt = null;
        e.wakeCheckDeadlineAt = deadline;
        saveEpisode(e);
        scheduler.schedule(RouseConstants.RC_WAKE_DEADLINE, deadline);
        Notifications.postWakeCheck(app, e);
        logEvent(e, "wake-check-shown", e.alarmId, fields("deadlineAt", deadline));
        emitWakeCheck(e);
    }

    private void onWakeDeadline() {
        Episode e = episodes.get();
        if (e == null || !Episode.STATE_WAKE_CHECK_PROMPT.equals(e.state)) return;
        Notifications.cancel(app, RouseConstants.NOTIF_WAKE_CHECK);
        e.wakeCheckReRings++;
        logEvent(e, "wake-check-failed", e.alarmId, fields("reRingCount", e.wakeCheckReRings));
        reRing(e, Episode.SOURCE_WAKE_CHECK);
    }

    private void onTestFire() {
        JSONObject pending = mirror.pendingTest();
        mirror.setPendingTest(null);
        if (pending == null) return;
        long now = now();
        long fireAt = pending.optLong("fireAt", now);
        AlarmSpec a;
        try {
            a = AlarmSpec.fromJson(pending.optJSONObject("alarm"));
        } catch (JSONException ex) {
            DiagLog.w("engine", "pending test alarm unreadable");
            return;
        }
        if (now - fireAt > RouseConstants.MISSED_GRACE_MS) {
            DiagLog.i("engine", "test alarm too old; dropped");
            return;
        }
        Episode existing = episodes.get();
        CollisionPolicy.Decision d = CollisionPolicy.decide(existing, true);
        if (d == CollisionPolicy.Decision.IGNORE_INCOMING) {
            DiagLog.i("engine", "test ring ignored: a real episode is active");
            return;
        }
        String sid = UUID.randomUUID().toString();
        if (existing != null) supersede(existing, sid);
        Episode e = new Episode();
        e.sessionId = sid;
        e.alarmId = a.id;
        e.alarm = a;
        e.source = Episode.SOURCE_TEST;
        e.state = Episode.STATE_RINGING;
        e.scheduledFor = fireAt;
        e.episodeStartedAt = now;
        e.ringStartedAt = now;
        e.isTest = true;
        memUiReadySession = null;
        saveEpisode(e);
        try {
            scheduler.schedule(RouseConstants.RC_SAFETY, now + RouseConstants.SAFETY_RERING_INTERVAL_MS);
        } finally {
            startRingService(e);
            launchRingUi(e);
            emitRing(e);
        }
    }

    /** RC_DEFERRED_START: whatever reconcile found overdue, now from an alarm-clock context. */
    private void onDeferredStart() {
        long now = now();
        Episode e = episodes.get();
        if (e != null) {
            if (e.isRinging()) {
                if (!RingService.isAlive(e.sessionId)) reRing(e, Episode.SOURCE_SAFETY);
            } else if (Episode.STATE_SNOOZED.equals(e.state) && (e.snoozeUntil == null || e.snoozeUntil <= now)) {
                onSnoozeEnd();
            } else if (Episode.STATE_WAKE_CHECK_WAIT.equals(e.state) && (e.wakeCheckAt == null || e.wakeCheckAt <= now)) {
                onWakeCheck();
            } else if (Episode.STATE_WAKE_CHECK_PROMPT.equals(e.state)
                && (e.wakeCheckDeadlineAt == null || e.wakeCheckDeadlineAt <= now)) {
                onWakeDeadline();
            }
        }
        Long catchUp = mirror.pendingCatchUp();
        if (catchUp != null) {
            mirror.setPendingCatchUp(null);
            handleDue(catchUp, Episode.SOURCE_CATCH_UP);
        }
    }

    private void onBedtime(long at) {
        mirror.setLastBedtimeAt(at > 0 ? at : now());
        JSONObject s = mirror.readScheduled();
        Long next = s == null ? null : AlarmSpec.optNullableLong(s, "fireAt");
        Notifications.postBedtime(app, next);
        rescheduleQuietly();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reconcile (boot, update, time change, permission change, app start) — plan §1.2 E
    // ─────────────────────────────────────────────────────────────────────────

    public void reconcile(final String reason) {
        post(() -> reconcileNow(reason));
    }

    private void reconcileNow(String reason) {
        DiagLog.i("reconcile", reason);
        Notifications.ensureChannels(app);
        long now = now();
        // D-046's lastHandledFireAt is an absolute instant. If the wall clock moved BACKWARDS past it
        // (manual time change, bad network time corrected), keeping it would make the next real
        // occurrences look "already handled" (dropped in handleDue) and skip them in rescheduleMain.
        long lastHandled = mirror.lastHandledFireAt();
        if (lastHandled > now + CLOCK_BACK_TOLERANCE_MS) {
            DiagLog.w("reconcile", "clock moved back; lastHandledFireAt reset");
            mirror.setLastHandledFireAt(now);
        }
        boolean needDeferred = false;
        Episode e = episodes.get();
        if (e != null) {
            switch (e.state) {
                case Episode.STATE_RINGING:
                    if (!RingService.isAlive(e.sessionId)) {
                        needDeferred = true; // never start the FGS from here (D-020)
                    } else {
                        scheduler.schedule(RouseConstants.RC_SAFETY, now + RouseConstants.SAFETY_RERING_INTERVAL_MS);
                        if (e.silenced) {
                            if (e.silenceUntil == null || e.silenceUntil <= now) {
                                expireSilence(e);
                            } else {
                                handler.removeCallbacks(silenceExpiry);
                                handler.postDelayed(silenceExpiry, e.silenceUntil - now);
                            }
                        }
                    }
                    break;
                case Episode.STATE_SNOOZED:
                    if (e.snoozeUntil == null || e.snoozeUntil <= now) {
                        needDeferred = true;
                    } else {
                        scheduler.schedule(RouseConstants.RC_SNOOZE, e.snoozeUntil);
                        Notifications.postSnoozed(app, e);
                    }
                    break;
                case Episode.STATE_WAKE_CHECK_WAIT:
                    if (e.wakeCheckAt == null || e.wakeCheckAt <= now) onWakeCheck();
                    else scheduler.schedule(RouseConstants.RC_WAKE_CHECK, e.wakeCheckAt);
                    break;
                case Episode.STATE_WAKE_CHECK_PROMPT:
                    if (e.wakeCheckDeadlineAt == null || e.wakeCheckDeadlineAt <= now) {
                        needDeferred = true;
                    } else {
                        scheduler.schedule(RouseConstants.RC_WAKE_DEADLINE, e.wakeCheckDeadlineAt);
                        Notifications.postWakeCheck(app, e);
                    }
                    break;
                default:
                    DiagLog.w("reconcile", "unknown episode state; dropped");
                    clearEpisode();
            }
        }
        Episode after = episodes.get();
        if (after == null || !after.isRinging()) {
            // A crash mid-ring may have left STREAM_ALARM forced; put the user's volume back.
            main.post(() -> {
                if (RingService.current() == null) VolumeLock.restoreSaved(app);
            });
        }

        // Missed / catch-up for the main alarm.
        JSONObject sch = mirror.readScheduled();
        Long fireAt = sch == null ? null : AlarmSpec.optNullableLong(sch, "fireAt");
        if (fireAt != null && fireAt <= now && fireAt > mirror.lastHandledFireAt()) {
            if (now - fireAt <= RouseConstants.MISSED_GRACE_MS) {
                mirror.setPendingCatchUp(fireAt);
            } else {
                mirror.setLastHandledFireAt(fireAt);
                List<ScheduleMath.Schedulable> due = ScheduleMath.dueAt(mirror.readAlarms(), fireAt, zone());
                for (ScheduleMath.Schedulable a : due) logEvent(null, "missed", a.getId(), fields("scheduledFor", fireAt));
            }
        }
        if (mirror.pendingCatchUp() != null) needDeferred = true;

        // Pending test ring.
        JSONObject pt = mirror.pendingTest();
        if (pt != null) {
            long at = pt.optLong("fireAt", 0L);
            if (at > now) scheduler.schedule(RouseConstants.RC_TEST, at);
            else if (now - at <= RouseConstants.MISSED_GRACE_MS) scheduler.schedule(RouseConstants.RC_TEST, now + RouseConstants.DEFERRED_START_DELAY_MS);
            else mirror.setPendingTest(null);
        }

        if (needDeferred) {
            scheduler.schedule(RouseConstants.RC_DEFERRED_START, now + RouseConstants.DEFERRED_START_DELAY_MS);
            DiagLog.i("reconcile", "deferred start armed");
        }
        rescheduleQuietly();
        if (reason != null && reason.contains("EXACT_ALARM")) emitHealthChanged();
    }
}
