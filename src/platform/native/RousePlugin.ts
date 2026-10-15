/**
 * Capacitor plugin "Rouse" — SHARED CONTRACT between TypeScript and Java.
 *
 * Java side: `app.rouse.alarm.RousePlugin` annotated `@CapacitorPlugin(name = "Rouse")`, registered
 * in MainActivity via `registerPlugin(RousePlugin.class)` BEFORE `super.onCreate()`.
 * Every method below is a `@PluginMethod public void <name>(PluginCall call)` with the SAME name.
 * Argument objects are read with `call.getString/getInt/getObject/getArray`; results are a
 * `JSObject` with EXACTLY the field names shown. `Promise<void>` methods call `call.resolve()`.
 *
 * Errors: `call.reject(message, code)` with `code` ∈ RousePluginErrorCode. TS sees `err.code`.
 *
 * JSON shapes of Alarm, ActiveRing, AlarmLogEvent, HealthStatus, SoundInfo, NextFire are defined in
 * src/core/types.ts and src/platform/AlarmBackend.ts — Java must produce/consume them verbatim:
 *   - Numbers that are epoch ms are JSON numbers (Java long → JSObject.put(key, long)).
 *   - Nullable fields are present with JSON null (JSObject.put(key, JSONObject.NULL)), never omitted.
 *   - Java must IGNORE unknown fields in Alarm JSON (forward compatibility) and must store the
 *     alarm JSON verbatim so that ActiveRing.alarm round-trips every field JS sent.
 *
 * Threading: methods may be called concurrently; Java serialises state mutation on a single
 * HandlerThread ("rouse-state") and persists to device-protected SharedPreferences
 * ("rouse_native", see docs/plan.md §3) before resolving.
 */
import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { Alarm, BedtimeReminderSettings, DismissVia, EpochMs, NextFire, SoundRef } from '../../core/types';
import type {
  ActiveRing,
  AlarmLogEvent,
  FixOutcome,
  HealthCheckId,
  HealthStatus,
  ScheduledAlarmInfo,
  SoundInfo,
} from '../AlarmBackend';

/** `code` values used in `call.reject(message, code)`. */
export type RousePluginErrorCode =
  | 'INVALID_ARGUMENT' //   malformed/missing argument
  | 'NO_ACTIVE_RING' //     ring method called with no episode in a compatible state
  | 'SESSION_MISMATCH' //   sessionId is not the current episode
  | 'SNOOZE_NOT_ALLOWED' // snooze disabled for this alarm, maxCount reached, or wake-check re-ring
  | 'UNSUPPORTED' //        not available on this SDK level / device
  | 'IO_ERROR'; //          storage / file copy failure

/** Subset of Settings the native side needs. Sent with every syncAlarms. */
export interface NativeSettingsMirror {
  bedtimeReminder: BedtimeReminderSettings;
  /** Settings.silenceWhileSolvingSec × 1000 — informational; leases carry their own duration. */
  silenceLeaseMs: number;
}

export interface SyncAlarmsOptions {
  /** = NATIVE_MIRROR_VERSION. Java rejects INVALID_ARGUMENT if greater than it understands. */
  mirrorVersion: number;
  /** ALL alarms (disabled included), full Alarm JSON. Replaces the mirror atomically. */
  alarms: Alarm[];
  settings: NativeSettingsMirror;
}

export interface SyncAlarmsResult {
  next: NextFire | null;
  alarms: ScheduledAlarmInfo[];
  bedtimeReminderAt: EpochMs | null;
}

export interface RousePluginApi {
  /**
   * Persist the mirror (alarms + settings) to device-protected storage, then recompute and
   * (re)schedule: the single main AlarmClock PendingIntent for the earliest NextFire, and the
   * bedtime reminder. Does NOT touch an active episode (its snooze / safety / wake-check alarms
   * stay). If the ringing alarm was deleted/edited, the episode keeps its snapshot.
   * Must compute next fire times with the algorithm in docs/plan.md §3.6 (identical to TS).
   */
  syncAlarms(options: SyncAlarmsOptions): Promise<SyncAlarmsResult>;

  /** The currently scheduled main fire (from storage; no recompute). */
  getNextFire(): Promise<{ next: NextFire | null }>;

  /** Evaluate every HealthCheckId (see AlarmBackend.ts) and return them all, in enum order. */
  getHealth(): Promise<HealthStatus>;

  /**
   * Fix one check:
   *  notifications → requestPermissionForAlias (POST_NOTIFICATIONS) on 33+, else open channel settings;
   *  exactAlarm → ACTION_REQUEST_SCHEDULE_EXACT_ALARM (31–32 only; 33+ USE_EXACT_ALARM is install-time);
   *  fullScreenIntent → ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT (34+);
   *  batteryOptimization → ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS with package: URI;
   *  backgroundRestricted / alarmVolume / dndAllowsAlarms → app details / sound settings / DND settings;
   *  camera → runtime CAMERA permission; motionSensors / lockedDevice → 'unsupported'.
   * Resolves immediately with 'settings-opened' when a settings screen was launched.
   */
  requestFix(options: { id: HealthCheckId }): Promise<{ outcome: FixOutcome }>;

  /**
   * Schedule a test ring of `alarm` (verbatim JSON, need not be in the mirror) at
   * now + delaySeconds via setAlarmClock (requestCode RC_TEST). Replaces a pending test.
   * The resulting episode has isTest=true, writes no log events, and never schedules a wake check.
   */
  testAlarm(options: { alarm: Alarm; delaySeconds: number }): Promise<{ fireAt: EpochMs }>;

  /**
   * The test ring scheduled by testAlarm that has not fired yet: { fireAt } or { fireAt: null }.
   * A pending test older than MISSED_GRACE_MS reads as none.
   */
  getPendingTest(): Promise<{ fireAt: EpochMs | null }>;

  /**
   * Cancel the pending test (cancel RC_TEST, clear the stored pending test). If the current episode
   * isTest (ringing or snoozed), end it exactly like dismiss(via 'no-mission'): stop audio/vibration/FGS,
   * cancel safety, restore volume, NO log events, emit 'ringState'(null). A real episode is never touched.
   * Resolves even when nothing was pending.
   */
  cancelTest(): Promise<void>;

  /** Current episode in any EpisodeState, or null. */
  getActiveRing(): Promise<{ ring: ActiveRing | null }>;

  /**
   * The WebView ring UI for `sessionId` is interactive: cancel the NATIVE_UI_READY_TIMEOUT_MS
   * fallback timer. If the native fallback is already on screen, leave it (either may dismiss).
   * Also accepted (no-op) while the episode is 'snoozed' (design §3.9 "I'm up — turn it off").
   * SESSION_MISMATCH if not the current episode; NO_ACTIVE_RING in any other state.
   */
  missionUiReady(options: { sessionId: string }): Promise<void>;

  /**
   * silenced=true: mute player (gain 0) and stop vibration; arm a lease timer of
   * min(leaseMs, MAX_SILENCE_LEASE_MS). Each call re-arms it. When it expires: resume at full
   * target gain (no ramp), set silenced=false, emit 'ringState'.
   * silenced=false: resume now. Persisted so a crash during silence resumes LOUD.
   * While the episode is 'snoozed' nothing is audible, so this resolves as a harmless no-op.
   */
  setSilenced(options: { sessionId: string; silenced: boolean; leaseMs: number }): Promise<void>;

  /**
   * Validate (episode 'ringing', alarm.snooze.enabled, snoozeCount < maxCount, source !==
   * 'wake-check'), then: stop audio/vibration/FGS, cancel safety alarm, snoozeCount++,
   * schedule RC_SNOOZE at now + intervalMin, state='snoozed', log 'snoozed', emit 'ringState'.
   * Reject SNOOZE_NOT_ALLOWED otherwise. When RC_SNOOZE fires: ring again (source 'snooze').
   */
  snooze(options: { sessionId: string }): Promise<{ snoozeUntil: EpochMs }>;

  /**
   * Mission(s) complete. Valid while 'ringing' or 'snoozed' (design §3.9 "I'm up — turn it off":
   * missions solved during the snooze; the pending RC_SNOOZE is cancelled first).
   * Stop audio/vibration/FGS, cancel safety alarm, restore alarm volume,
   * clear showWhenLocked. If alarm.wakeUpCheck.enabled and !isTest and wakeCheckReRings <
   * WAKE_CHECK_MAX_RERINGS: state='wake-check-wait', schedule RC_WAKE_CHECK at now + delayMin;
   * else end the episode. Log 'dismissed' (+ 'episode-ended'), emit 'ringState'.
   */
  dismiss(options: { sessionId: string; via: DismissVia }): Promise<{ wakeCheckAt: EpochMs | null }>;

  /**
   * "I'm awake": valid in 'wake-check-wait' (early confirm) or 'wake-check-prompt'. Cancels
   * RC_WAKE_CHECK / RC_WAKE_DEADLINE, removes the prompt notification, ends the episode,
   * logs 'wake-check-confirmed' + 'episode-ended'. Also triggered natively by the notification action.
   */
  confirmAwake(options: { sessionId: string }): Promise<void>;

  /** Log events with seq > afterSeq, ascending. `lastSeq` = highest seq ever issued (0 if none). */
  getLog(options: { afterSeq: number }): Promise<{ events: AlarmLogEvent[]; lastSeq: number }>;

  /** Drop events with seq <= throughSeq from storage. seq counter is never reset. */
  ackLog(options: { throughSeq: number }): Promise<void>;

  /** Bundled sounds (BUNDLED_SOUNDS order) followed by stored custom sounds (newest first). */
  listSounds(): Promise<{ sounds: SoundInfo[] }>;

  /** Preview on USAGE_ALARM at `volume`% of STREAM_ALARM max (restores volume after). Auto-stops after 15 s. */
  previewSound(options: { sound: SoundRef; volume: number }): Promise<void>;

  stopPreview(): Promise<void>;

  /**
   * ACTION_OPEN_DOCUMENT (audio/*). Copy to device-protected files dir `sounds/<uuid>.<ext>`
   * (reject IO_ERROR if > MAX_CUSTOM_SOUND_BYTES or unreadable); verify it decodes with
   * MediaPlayer.prepare(). Resolves { sound: null } if cancelled.
   */
  pickCustomSound(): Promise<{ sound: SoundInfo | null }>;

  /** Delete a stored custom sound. Alarms still referencing it will use the backup tone. */
  deleteCustomSound(options: { id: string }): Promise<void>;

  /** Last ≤200 lines of the native diagnostic ring buffer (no personal data), for "Copy diagnostics". */
  getDiagnostics(): Promise<{ lines: string[] }>;

  // ── Events: Java calls notifyListeners(name, data, /* retainUntilConsumed */ true) ──
  /** Episode entered 'ringing'. data = { ring: ActiveRing } */
  addListener(eventName: 'ring', listener: (data: { ring: ActiveRing }) => void): Promise<PluginListenerHandle>;
  /** Episode entered 'wake-check-prompt'. data = { ring: ActiveRing } */
  addListener(eventName: 'wakeCheck', listener: (data: { ring: ActiveRing }) => void): Promise<PluginListenerHandle>;
  /** Any other episode change; ring = null when the episode ended. */
  addListener(eventName: 'ringState', listener: (data: { ring: ActiveRing | null }) => void): Promise<PluginListenerHandle>;
  /** New log events were appended. data = { lastSeq } */
  addListener(eventName: 'log', listener: (data: { lastSeq: number }) => void): Promise<PluginListenerHandle>;
  /** Exact-alarm permission broadcast, app resume (handleOnResume), DND/volume change. data = {} */
  addListener(eventName: 'healthChanged', listener: (data: Record<string, never>) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

/** The plugin proxy. Only NativeAlarmBackend may import this. Calling it on web throws "not implemented". */
export const Rouse = registerPlugin<RousePluginApi>('Rouse');
