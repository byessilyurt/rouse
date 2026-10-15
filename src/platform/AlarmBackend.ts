/**
 * AlarmBackend — SHARED CONTRACT between core/UI and the two platform implementations:
 *   - NativeAlarmBackend (src/platform/native/) → Capacitor plugin "Rouse" → Java. Owns real ringing.
 *   - WebAlarmBackend    (src/platform/web/)    → in-page timers + WebAudio. Demo & e2e harness only.
 *
 * The UI never talks to the plugin directly. Core's RouseService and RingController are the
 * only callers of the mutating ring methods (snooze / dismiss / setSilenced / missionUiReady).
 *
 * Wire note: the data types below (ActiveRing, AlarmLogEvent, HealthStatus, SoundInfo, …) are
 * ALSO the JSON shapes the Java plugin returns. NativeAlarmBackend passes them through unchanged.
 */
import type { Alarm, DismissVia, EpisodeState, EpochMs, NextFire, RingSource, Settings, SoundRef } from '../core/types';

// ─────────────────────────────────────────────────────────────────────────────
// Ring state
// ─────────────────────────────────────────────────────────────────────────────

/** Authoritative state of the current wake episode, as held by the backend. */
export interface ActiveRing {
  /** UUID, constant for the whole episode (across snoozes / re-rings). */
  sessionId: string;
  alarmId: string;
  /** Alarm snapshot from the backend mirror at episode start (for test rings: the alarm passed to testAlarm). */
  alarm: Alarm;
  /** Source of the CURRENT ring (changes on snooze return / safety re-ring / wake-check re-ring). */
  source: RingSource;
  state: EpisodeState;
  /** Instant that started the episode (scheduled fire time; for catch-up, the missed fire time). */
  scheduledFor: EpochMs | null;
  episodeStartedAt: EpochMs;
  /** Start of the current ring, null when not ringing. */
  ringStartedAt: EpochMs | null;
  snoozeCount: number;
  /** Set while state === 'snoozed'. */
  snoozeUntil: EpochMs | null;
  /** Set while state === 'wake-check-wait'. */
  wakeCheckAt: EpochMs | null;
  /** Set while state === 'wake-check-prompt'. */
  wakeCheckDeadlineAt: EpochMs | null;
  wakeCheckReRings: number;
  /** Audio currently muted by a silence lease. */
  silenced: boolean;
  /** Native fallback mission is (or was) on screen for this episode. */
  nativeFallbackShown: boolean;
  isTest: boolean;
}

/** Proof-of-mission token. Only RingController mints it (`as DismissToken`); grep for casts in review. */
declare const dismissTokenBrand: unique symbol;
export type DismissToken = {
  readonly sessionId: string;
  readonly via: DismissVia;
  readonly [dismissTokenBrand]: true;
};

export interface DismissResult {
  /** When the wake-up check will be shown, or null if the episode ended. */
  wakeCheckAt: EpochMs | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Log events (durable queue; drives one-off disabling and statistics)
// ─────────────────────────────────────────────────────────────────────────────

interface LogBase {
  /** Strictly increasing per install. Never reused, even after ackLog. */
  seq: number;
  at: EpochMs;
  sessionId: string;
  alarmId: string;
}

/**
 * Durable record of something the backend did, queued even while JS is dead.
 * Core applies them idempotently (by seq > meta.lastAppliedLogSeq) to alarms and wake records.
 * Test rings (isTest) produce NO log events.
 */
export type AlarmLogEvent =
  | (LogBase & { type: 'ring-started'; source: RingSource; scheduledFor: EpochMs | null })
  | (LogBase & { type: 'snoozed'; snoozeCount: number; snoozeUntil: EpochMs })
  | (LogBase & { type: 'dismissed'; via: DismissVia | 'native-fallback'; wakeCheckAt: EpochMs | null })
  | (LogBase & { type: 'wake-check-shown'; deadlineAt: EpochMs })
  | (LogBase & { type: 'wake-check-confirmed' })
  /** Deadline passed without confirmation; the alarm re-rings (source 'wake-check'). */
  | (LogBase & { type: 'wake-check-failed'; reRingCount: number })
  /** A one-off alarm fired: core must set enabled=false, or delete it if deleteAfterRing. */
  | (LogBase & { type: 'one-off-consumed' })
  /** Fire time passed by more than MISSED_GRACE_MS (device off, app force-stopped…). */
  | (LogBase & { type: 'missed'; scheduledFor: EpochMs })
  /** Alarm was due at the same instant as the ringing alarm (sessionId = the ringing episode). */
  | (LogBase & { type: 'merged'; ringingAlarmId: string })
  /** Previous episode (this sessionId) ended because a new alarm fired. */
  | (LogBase & { type: 'superseded'; bySessionId: string })
  /** Episode is over; no more events for this sessionId. */
  | (LogBase & { type: 'episode-ended'; reason: 'dismissed' | 'wake-check-confirmed' | 'superseded' });

export type AlarmLogEventType = AlarmLogEvent['type'];

// ─────────────────────────────────────────────────────────────────────────────
// Health / permissions
// ─────────────────────────────────────────────────────────────────────────────

export type HealthCheckId =
  | 'exactAlarm' //          canScheduleExactAlarms() (USE_EXACT_ALARM normally makes this ok)
  | 'notifications' //       POST_NOTIFICATIONS (API 33+) and channel not blocked
  | 'fullScreenIntent' //    NotificationManager.canUseFullScreenIntent() (API 34+)
  | 'batteryOptimization' // PowerManager.isIgnoringBatteryOptimizations()
  | 'backgroundRestricted' //ActivityManager.isBackgroundRestricted() (API 28+)
  | 'dndAllowsAlarms' //     interruption filter / policy lets alarms through
  | 'alarmVolume' //         STREAM_ALARM volume > 0 (we force it while ringing, but warn)
  | 'camera' //              CAMERA runtime permission (only relevant if a QR mission exists)
  | 'motionSensors' //       accelerometer present
  | 'lockedDevice'; //       platform can wake a locked phone (false on web — the honesty banner)

export type HealthState =
  | 'ok'
  | 'action-needed' // fixable: see `fix`
  | 'unsupported' //   cannot be fixed on this device/platform
  | 'unknown';

export interface HealthCheck {
  id: HealthCheckId;
  state: HealthState;
  /** critical = alarms may not ring; recommended = may ring late/quietly; optional = a mission may not work. */
  severity: 'critical' | 'recommended' | 'optional';
  /** What `requestFix(id)` will do. */
  fix: 'request-permission' | 'open-settings' | 'none';
  /** Short English detail for the UI, e.g. "Battery optimisation is on for Rouse". */
  detail: string;
}

export interface HealthStatus {
  platform: 'android' | 'web';
  /** Build.VERSION.SDK_INT, null on web. */
  sdkInt: number | null;
  /** Build.MANUFACTURER lower-cased (for dontkillmyapp.com/<vendor> guidance), null on web. */
  manufacturer: string | null;
  checks: HealthCheck[];
  checkedAt: EpochMs;
}

export type FixOutcome =
  | 'already-ok'
  | 'granted'
  | 'denied'
  /** A system settings screen was opened; re-check health when the app resumes. */
  | 'settings-opened'
  | 'unsupported';

// ─────────────────────────────────────────────────────────────────────────────
// Sync / sounds
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduledAlarmInfo {
  alarmId: string;
  /** Backend-computed next fire (null = disabled or no future occurrence). */
  nextFireAt: EpochMs | null;
}

export interface SyncResult {
  next: NextFire | null;
  /** Per-alarm next fire as computed by the backend. Core compares with its own computation (D-011). */
  alarms: ScheduledAlarmInfo[];
  /** Bedtime reminder instant scheduled, or null. */
  bedtimeReminderAt: EpochMs | null;
}

export interface SoundInfo {
  ref: SoundRef;
  name: string;
  /** Loop/file duration if known. */
  durationMs: number | null;
}

export interface BackendCapabilities {
  /** Rings with the phone locked / app closed / device dozing. false = web demo. */
  canWakeLockedDevice: boolean;
  /** Hardware volume keys cannot lower the alarm while ringing. */
  canLockVolume: boolean;
  canPickCustomSound: boolean;
  /** Has a non-WebView fallback mission if the UI dies. */
  hasNativeFallback: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live events
// ─────────────────────────────────────────────────────────────────────────────

export type BackendEvent =
  /** Episode entered 'ringing' (fresh fire, snooze return, safety re-ring, wake-check re-ring). UI → #/ring. */
  | { type: 'ring'; ring: ActiveRing }
  /** Episode entered 'wake-check-prompt'. UI → #/wake-check. */
  | { type: 'wake-check'; ring: ActiveRing }
  /** Any other change to the episode (snoozed, silenced flag, wake-check-wait), or null when it ended. */
  | { type: 'ring-state'; ring: ActiveRing | null }
  /** New durable log events are available; call getLog(). */
  | { type: 'log' }
  /** A permission/health input changed (e.g. exact-alarm permission toggled, app resumed). */
  | { type: 'health-changed' };

export type BackendListener = (event: BackendEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// The interface
// ─────────────────────────────────────────────────────────────────────────────

export interface AlarmBackend {
  readonly kind: 'native' | 'web';
  readonly capabilities: BackendCapabilities;

  /** One-time setup (register listeners, restore web state). Idempotent. */
  init(): Promise<void>;

  /**
   * Replace the backend's alarm mirror and reschedule everything. Called by RouseService after
   * every alarm/settings change and on app start. Idempotent; full-state, never incremental.
   * Pass ALL alarms (disabled ones too). Settings are needed for bedtime reminder.
   */
  sync(alarms: readonly Alarm[], settings: Settings): Promise<SyncResult>;

  /** Next scheduled fire across all alarms, as currently scheduled by the backend. */
  getNextFire(): Promise<NextFire | null>;

  // ── Health ────────────────────────────────────────────────────────────────
  getHealth(): Promise<HealthStatus>;
  /** Request the permission or open the settings screen for one check. Re-query getHealth afterwards. */
  requestFix(id: HealthCheckId): Promise<FixOutcome>;

  /** Ring `alarm` (need not be saved) in `delaySeconds` (1..3600) as a test: no log events, no stats. */
  testAlarm(alarm: Alarm, delaySeconds: number): Promise<{ fireAt: EpochMs }>;

  // ── Ring session ──────────────────────────────────────────────────────────
  /** Current episode (any state) or null. Called on app start to route to #/ring or #/wake-check. */
  getActiveRing(): Promise<ActiveRing | null>;
  /** The ring/mission UI for this session is rendered and interactive. Cancels the native fallback timer. */
  missionUiReady(sessionId: string): Promise<void>;
  /**
   * Silence-while-solving lease. silenced=true mutes audio+vibration for `leaseMs` (clamped to
   * MAX_SILENCE_LEASE_MS); if not renewed in time, audio resumes at full target volume. silenced=false resumes now.
   */
  setSilenced(sessionId: string, silenced: boolean, leaseMs: number): Promise<void>;
  /** Snooze the ringing episode. Rejects if snooze is disabled or maxCount reached (backend enforces too). */
  snooze(sessionId: string): Promise<{ snoozeUntil: EpochMs }>;
  /** Stop ringing after mission success. ONLY RingController may call this (DismissToken). */
  dismiss(token: DismissToken): Promise<DismissResult>;
  /** User confirmed the wake-up check ("I'm awake"). Ends the episode. */
  confirmAwake(sessionId: string): Promise<void>;

  // ── Durable log ───────────────────────────────────────────────────────────
  /** Events with seq > afterSeq, ascending. */
  getLog(afterSeq: number): Promise<AlarmLogEvent[]>;
  /** Backend may drop events with seq <= throughSeq. Call after persisting their effects. */
  ackLog(throughSeq: number): Promise<void>;

  // ── Sounds ────────────────────────────────────────────────────────────────
  listSounds(): Promise<SoundInfo[]>;
  /** Play `sound` at `volume` (10..100, % of alarm stream) until stopPreview or 15 s. Replaces any running preview. */
  previewSound(sound: SoundRef, volume: number): Promise<void>;
  stopPreview(): Promise<void>;
  /** Open the system picker; copies the file into app storage. null if the user cancelled. */
  pickCustomSound(): Promise<SoundInfo | null>;
  deleteCustomSound(id: string): Promise<void>;

  /** Subscribe to live events. Returns an unsubscribe function. */
  subscribe(listener: BackendListener): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Web-only test hooks (e2e). Installed by WebAlarmBackend on `window.__rouseTest`
// when the page URL contains `e2e=1` (search or hash query). Never present on native.
// ─────────────────────────────────────────────────────────────────────────────

export interface RouseTestHooks {
  /** Start ringing `alarmId` immediately as if scheduled (source 'scheduled'). Resolves to sessionId. */
  ringNow(alarmId: string): Promise<string>;
  /** Fire the pending snooze / wake-check / wake-check-deadline timer now, whichever is next. */
  fireNextTimer(): Promise<void>;
  /** Deliver a decoded code to the active QR mission scanner (no camera in CI). */
  injectScan(text: string): void;
  /** Snapshot of web backend state for assertions (ActiveRing, scheduled timers, preview state). */
  inspect(): {
    ring: ActiveRing | null;
    audio: 'playing' | 'silenced' | 'stopped';
    timers: { kind: 'alarm' | 'snooze' | 'wake-check' | 'wake-check-deadline' | 'test' | 'bedtime'; at: EpochMs }[];
    log: AlarmLogEvent[];
  };
}

declare global {
  interface Window {
    __rouseTest?: RouseTestHooks;
  }
}
