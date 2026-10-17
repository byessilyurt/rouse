/**
 * WebAlarmBackend — OWNER: UI agent.
 * Demo/e2e implementation of AlarmBackend: setTimeout scheduling (re-armed on visibility/
 * focus and every 30 s against the injected clock, so page.clock in Playwright drives it),
 * WebAudio synthesis of BUNDLED_SOUNDS recipes, Notification API best-effort, state in
 * localStorage ('rouse.web.backend') so a reload mid-ring keeps ringing (mirrors the native
 * safety re-ring). Uses core/schedule.ts for next-fire math (it IS the TS algorithm).
 *
 * Episode rules mirror the native contract in RousePlugin.ts: snooze validation, silence lease
 * (≤ MAX_SILENCE_LEASE_MS, resumes loud), wake-up check (≤ WAKE_CHECK_MAX_RERINGS re-rings),
 * collision policy (D-014), durable seq-numbered log, test rings without log events.
 * It cannot wake a locked phone or ring with the tab closed — getHealth() says so.
 */
import type {
  ActiveRing,
  AlarmBackend,
  AlarmLogEvent,
  BackendEvent,
  BackendListener,
  DismissResult,
  DismissToken,
  FixOutcome,
  HealthCheck,
  HealthCheckId,
  HealthStatus,
  RouseTestHooks,
  SoundInfo,
  SyncResult,
} from '../AlarmBackend';
import type { Alarm, BedtimeReminderSettings, EpochMs, NextFire, RingSource, Settings, SoundRef } from '../../core/types';
import {
  BACKUP_SOUND_ID,
  BUNDLED_SOUNDS,
  MAX_SILENCE_LEASE_MS,
  MISSED_GRACE_MS,
  NATIVE_LOG_CAP,
  WAKE_CHECK_MAX_RERINGS,
} from '../../core/defaults';
import { bedtimeReminderAt, nextFire, nextOccurrence } from '../../core/schedule';
import { formatDiagnostics } from '../diagnostics';
import { ToneVoice, audioAvailable, audioBlocked, unlockAudio } from './audio';

export interface WebAlarmBackendOptions {
  /** Install window.__rouseTest (RouseTestHooks). */
  testHooks?: boolean;
  /** Injectable clock for unit tests. Default Date.now. */
  now?: () => EpochMs;
  /** Injectable storage for unit tests. Default window.localStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/** localStorage key of the web backend's own state (separate from core's 'rouse.state'). */
export const WEB_BACKEND_KEY = 'rouse.web.backend';
/** Window event the QR scanner listens to; dispatched by __rouseTest.injectScan. */
export const TEST_SCAN_EVENT = 'rouse:test-scan';
/** Upper bound for one timer; the backend re-checks at least this often. */
export const WEB_CHECK_INTERVAL_MS = 30_000;

type TimerKind = 'alarm' | 'snooze' | 'wake-check' | 'wake-check-deadline' | 'test' | 'bedtime';

interface WebEpisode extends ActiveRing {
  /** Silence lease end while silenced. */
  silenceUntil: EpochMs | null;
}

interface WebState {
  v: 1;
  alarms: Alarm[];
  bedtime: BedtimeReminderSettings | null;
  scheduled: NextFire | null;
  bedtimeAt: EpochMs | null;
  episode: WebEpisode | null;
  test: { alarm: Alarm; fireAt: EpochMs } | null;
  nextSeq: number;
  /** Events not yet dropped (acked events are kept for inspection until the cap). */
  log: AlarmLogEvent[];
  ackedThrough: number;
}

const emptyState = (): WebState => ({
  v: 1,
  alarms: [],
  bedtime: null,
  scheduled: null,
  bedtimeAt: null,
  episode: null,
  test: null,
  nextSeq: 1,
  log: [],
  ackedThrough: 0,
});

type LogPayload = AlarmLogEvent extends infer E ? (E extends AlarmLogEvent ? Omit<E, 'seq' | 'at'> : never) : never;

function rejectWith(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class WebAlarmBackend implements AlarmBackend {
  readonly kind = 'web' as const;
  readonly capabilities = {
    canWakeLockedDevice: false,
    canLockVolume: false,
    canPickCustomSound: false,
    hasNativeFallback: false,
  };

  private state: WebState = emptyState();
  private listeners = new Set<BackendListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private readonly now: () => EpochMs;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  private readonly ringVoice = new ToneVoice();
  private readonly previewVoice = new ToneVoice();
  private vibrateTimer: ReturnType<typeof setInterval> | null = null;
  private gestureButton: HTMLButtonElement | null = null;
  private previewing = false;
  private disposers: (() => void)[] = [];

  constructor(private readonly options: WebAlarmBackendOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.load();
    if (typeof window !== 'undefined') {
      const recheck = () => this.check();
      const onVis = () => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          this.check();
          this.emit({ type: 'health-changed' });
        }
      };
      const onGesture = () => {
        void unlockAudio().then(() => this.updateGestureButton());
      };
      window.addEventListener('focus', recheck);
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('pointerdown', onGesture, true);
      window.addEventListener('keydown', onGesture, true);
      this.disposers.push(
        () => window.removeEventListener('focus', recheck),
        () => document.removeEventListener('visibilitychange', onVis),
        () => window.removeEventListener('pointerdown', onGesture, true),
        () => window.removeEventListener('keydown', onGesture, true),
      );
      if (this.options.testHooks) this.installTestHooks();
    }
    // A ring that was in progress when the page went away resumes loud, like the native safety re-ring.
    const ep = this.state.episode;
    if (ep && ep.state === 'ringing') {
      const now = this.now();
      ep.source = ep.isTest ? ep.source : 'safety';
      ep.ringStartedAt = now;
      ep.silenced = false;
      ep.silenceUntil = null;
      if (!ep.isTest) this.log({ type: 'ring-started', sessionId: ep.sessionId, alarmId: ep.alarmId, source: 'safety', scheduledFor: ep.scheduledFor });
      this.persist();
      this.startRingOutput(ep);
    }
    this.check();
  }

  /** Remove listeners and timers (tests). */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopRingOutput();
    this.previewVoice.stop();
    for (const d of this.disposers.splice(0)) d();
    if (typeof window !== 'undefined' && this.options.testHooks && window.__rouseTest) delete window.__rouseTest;
    this.initialized = false;
  }

  private load(): void {
    const raw = this.safeGet();
    if (!raw) {
      this.state = emptyState();
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<WebState>;
      this.state = { ...emptyState(), ...parsed, v: 1 };
      if (!Array.isArray(this.state.alarms)) this.state.alarms = [];
      if (!Array.isArray(this.state.log)) this.state.log = [];
    } catch {
      this.state = emptyState();
    }
  }

  private safeGet(): string | null {
    try {
      return this.storage?.getItem(WEB_BACKEND_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(WEB_BACKEND_KEY, JSON.stringify(this.state));
    } catch {
      /* storage full / blocked: keep running in memory */
    }
  }

  // ── events ────────────────────────────────────────────────────────────────

  subscribe(listener: BackendListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Events are delivered asynchronously, after the call that caused them resolves (like the plugin bridge). */
  private emit(event: BackendEvent): void {
    const snapshot = JSON.parse(JSON.stringify(event)) as BackendEvent;
    setTimeout(() => {
      for (const l of [...this.listeners]) {
        try {
          l(snapshot);
        } catch (e) {
          console.error('[rouse] backend listener failed', e);
        }
      }
    }, 0);
  }

  private publicRing(ep: WebEpisode | null): ActiveRing | null {
    if (!ep) return null;
    const { silenceUntil: _omit, ...ring } = ep;
    void _omit;
    return JSON.parse(JSON.stringify(ring)) as ActiveRing;
  }

  private log(payload: LogPayload): void {
    const ev = { ...payload, seq: this.state.nextSeq++, at: this.now() } as AlarmLogEvent;
    this.state.log.push(ev);
    if (this.state.log.length > NATIVE_LOG_CAP) this.state.log.splice(0, this.state.log.length - NATIVE_LOG_CAP);
    this.logDirty = true;
  }
  private logDirty = false;
  private flushLog(): void {
    if (this.logDirty) {
      this.logDirty = false;
      this.emit({ type: 'log' });
    }
  }

  // ── scheduling ────────────────────────────────────────────────────────────

  async sync(alarms: readonly Alarm[], settings: Settings): Promise<SyncResult> {
    this.check();
    const now = this.now();
    this.state.alarms = JSON.parse(JSON.stringify(alarms)) as Alarm[];
    this.state.bedtime = { ...settings.bedtimeReminder };
    this.reschedule(now);
    this.persist();
    this.arm();
    return {
      next: this.state.scheduled,
      alarms: this.state.alarms.map((a) => ({ alarmId: a.id, nextFireAt: a.enabled ? nextOccurrence(a, now) : null })),
      bedtimeReminderAt: this.state.bedtimeAt,
    };
  }

  async getNextFire(): Promise<NextFire | null> {
    return this.state.scheduled;
  }

  private reschedule(now: EpochMs): void {
    this.state.scheduled = nextFire(this.state.alarms, now);
    this.state.bedtimeAt = this.state.bedtime ? bedtimeReminderAt(this.state.alarms, this.state.bedtime, now) : null;
  }

  private pendingTimers(): { kind: TimerKind; at: EpochMs }[] {
    const s = this.state;
    const out: { kind: TimerKind; at: EpochMs }[] = [];
    if (s.scheduled) out.push({ kind: 'alarm', at: s.scheduled.fireAt });
    const ep = s.episode;
    if (ep?.state === 'snoozed' && ep.snoozeUntil != null) out.push({ kind: 'snooze', at: ep.snoozeUntil });
    if (ep?.state === 'wake-check-wait' && ep.wakeCheckAt != null) out.push({ kind: 'wake-check', at: ep.wakeCheckAt });
    if (ep?.state === 'wake-check-prompt' && ep.wakeCheckDeadlineAt != null) out.push({ kind: 'wake-check-deadline', at: ep.wakeCheckDeadlineAt });
    if (s.test) out.push({ kind: 'test', at: s.test.fireAt });
    if (s.bedtimeAt != null) out.push({ kind: 'bedtime', at: s.bedtimeAt });
    return out.sort((a, b) => a.at - b.at);
  }

  /** One timer for the earliest due instant, capped at WEB_CHECK_INTERVAL_MS (the 30 s re-check). */
  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.initialized) return;
    const now = this.now();
    let next = now + WEB_CHECK_INTERVAL_MS;
    for (const t of this.pendingTimers()) next = Math.min(next, t.at);
    const ep = this.state.episode;
    if (ep?.silenced && ep.silenceUntil != null) next = Math.min(next, ep.silenceUntil);
    const delay = Math.max(0, Math.min(WEB_CHECK_INTERVAL_MS, next - now));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.check();
    }, delay);
  }

  /** Process everything that is due at the injected `now`, then re-arm. */
  check(): void {
    for (let guard = 0; guard < 50; guard++) {
      const now = this.now();
      const ep = this.state.episode;
      if (ep && ep.state === 'ringing' && ep.silenced && ep.silenceUntil != null && ep.silenceUntil <= now) {
        this.setSilencedInternal(ep, false, 0);
        continue;
      }
      const due = this.pendingTimers().find((t) => t.at <= now);
      if (!due) break;
      this.fireTimer(due.kind, now);
    }
    this.persist();
    this.flushLog();
    this.arm();
  }

  private fireTimer(kind: TimerKind, now: EpochMs): void {
    const s = this.state;
    const ep = s.episode;
    switch (kind) {
      case 'alarm': {
        const sched = s.scheduled;
        if (!sched) return;
        this.onMainFire(sched.fireAt, sched.alarmIds, now);
        return;
      }
      case 'snooze':
        if (ep) this.ringAgain(ep, 'snooze', now);
        return;
      case 'wake-check':
        if (ep) this.showWakeCheck(ep, now);
        return;
      case 'wake-check-deadline':
        if (ep) {
          ep.wakeCheckReRings += 1;
          ep.wakeCheckDeadlineAt = null;
          if (!ep.isTest) this.log({ type: 'wake-check-failed', sessionId: ep.sessionId, alarmId: ep.alarmId, reRingCount: ep.wakeCheckReRings });
          this.ringAgain(ep, 'wake-check', now);
        }
        return;
      case 'test': {
        const test = s.test;
        s.test = null;
        if (!test) return;
        // Test rings never supersede a real episode (D-014, D-030).
        if (ep && !ep.isTest) return;
        this.startEpisode(test.alarm, 'test', now, now, true);
        return;
      }
      case 'bedtime': {
        const at = s.bedtimeAt;
        s.bedtimeAt = null;
        const fire = s.scheduled;
        if (at != null && fire) {
          const d = new Date(fire.fireAt);
          const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          this.notify('Bedtime', `Bedtime. Your alarm is set for ${time}.`);
        }
        // Next reminder is computed on the next sync; avoid re-firing for the same alarm.
        return;
      }
    }
  }

  /** Native RingEngine.onMainFire equivalent (plan §1.2 B.1). */
  private onMainFire(fireAt: EpochMs, ids: readonly string[], now: EpochMs): void {
    const s = this.state;
    if (now - fireAt > MISSED_GRACE_MS) {
      for (const id of ids) this.log({ type: 'missed', sessionId: uuid(), alarmId: id, scheduledFor: fireAt });
      this.reschedule(now);
      return;
    }
    const due = s.alarms.filter((a) => ids.includes(a.id) && a.enabled && nextOccurrence(a, fireAt - 1) === fireAt);
    if (due.length === 0) {
      this.reschedule(now);
      return;
    }
    due.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.fireAlarms(due, fireAt, now);
    this.reschedule(Math.max(now, fireAt));
  }

  private fireAlarms(due: Alarm[], fireAt: EpochMs, now: EpochMs): string {
    const ep = this.state.episode;
    const primary = due[0]!;
    if (ep && ep.state === 'ringing' && !ep.isTest) {
      // Collision: an alarm fires while another is ringing → merged into the ringing episode.
      for (const a of due) {
        this.log({ type: 'merged', sessionId: ep.sessionId, alarmId: a.id, ringingAlarmId: ep.alarmId });
        this.consumeOneOff(a, ep.sessionId);
      }
      return ep.sessionId;
    }
    if (ep && !ep.isTest) {
      // Snoozed or wake-check episode: the new alarm supersedes it.
      const newId = uuid();
      this.log({ type: 'superseded', sessionId: ep.sessionId, alarmId: ep.alarmId, bySessionId: newId });
      this.log({ type: 'episode-ended', sessionId: ep.sessionId, alarmId: ep.alarmId, reason: 'superseded' });
      this.state.episode = null;
      return this.startEpisodeWith(newId, primary, due, fireAt, now);
    }
    // No episode, or a test ring (a real alarm always wins over a test).
    if (ep?.isTest) this.state.episode = null;
    return this.startEpisodeWith(uuid(), primary, due, fireAt, now);
  }

  private startEpisodeWith(sessionId: string, primary: Alarm, due: Alarm[], fireAt: EpochMs, now: EpochMs): string {
    const ep = this.startEpisode(primary, 'scheduled', fireAt, now, false, sessionId);
    for (const a of due) {
      if (a.id !== primary.id) this.log({ type: 'merged', sessionId: ep.sessionId, alarmId: a.id, ringingAlarmId: primary.id });
      this.consumeOneOff(a, ep.sessionId);
    }
    return ep.sessionId;
  }

  private consumeOneOff(a: Alarm, sessionId: string): void {
    if (a.days.length > 0) return;
    const mirror = this.state.alarms.find((x) => x.id === a.id);
    if (mirror) mirror.enabled = false;
    this.log({ type: 'one-off-consumed', sessionId, alarmId: a.id });
  }

  private startEpisode(alarm: Alarm, source: RingSource, scheduledFor: EpochMs | null, now: EpochMs, isTest: boolean, sessionId = uuid()): WebEpisode {
    const ep: WebEpisode = {
      sessionId,
      alarmId: alarm.id,
      alarm: JSON.parse(JSON.stringify(alarm)) as Alarm,
      source,
      state: 'ringing',
      scheduledFor,
      episodeStartedAt: now,
      ringStartedAt: now,
      snoozeCount: 0,
      snoozeUntil: null,
      wakeCheckAt: null,
      wakeCheckDeadlineAt: null,
      wakeCheckReRings: 0,
      silenced: false,
      nativeFallbackShown: false,
      isTest,
      silenceUntil: null,
    };
    this.state.episode = ep;
    if (!isTest) this.log({ type: 'ring-started', sessionId, alarmId: alarm.id, source, scheduledFor });
    this.startRingOutput(ep);
    this.emit({ type: 'ring', ring: this.publicRing(ep)! });
    return ep;
  }

  private ringAgain(ep: WebEpisode, source: RingSource, now: EpochMs): void {
    ep.state = 'ringing';
    ep.source = source;
    ep.ringStartedAt = now;
    ep.snoozeUntil = null;
    ep.wakeCheckAt = null;
    ep.wakeCheckDeadlineAt = null;
    ep.silenced = false;
    ep.silenceUntil = null;
    if (!ep.isTest) this.log({ type: 'ring-started', sessionId: ep.sessionId, alarmId: ep.alarmId, source, scheduledFor: ep.scheduledFor });
    this.startRingOutput(ep);
    this.emit({ type: 'ring', ring: this.publicRing(ep)! });
  }

  private showWakeCheck(ep: WebEpisode, now: EpochMs): void {
    ep.state = 'wake-check-prompt';
    ep.wakeCheckAt = null;
    ep.wakeCheckDeadlineAt = now + ep.alarm.wakeUpCheck.windowMin * 60_000;
    if (!ep.isTest) this.log({ type: 'wake-check-shown', sessionId: ep.sessionId, alarmId: ep.alarmId, deadlineAt: ep.wakeCheckDeadlineAt });
    const chime = BUNDLED_SOUNDS.find((s) => s.id === 'chime');
    if (chime) this.previewVoice.play(chime.recipe, { volume: 0.6, loop: false });
    this.notify('Still up?', "Tap I'm awake, or the alarm rings again.");
    this.emit({ type: 'wake-check', ring: this.publicRing(ep)! });
  }

  // ── ring output (audio / vibration / notification) ────────────────────────

  private recipeFor(sound: SoundRef) {
    const id = sound.kind === 'bundled' ? sound.id : BACKUP_SOUND_ID;
    return (BUNDLED_SOUNDS.find((s) => s.id === id) ?? BUNDLED_SOUNDS.find((s) => s.id === BACKUP_SOUND_ID)!).recipe;
  }

  private startRingOutput(ep: WebEpisode): void {
    this.previewVoice.stop();
    this.ringVoice.play(this.recipeFor(ep.alarm.sound), { volume: ep.alarm.volume / 100, rampSec: ep.alarm.volumeRampSec, loop: true });
    if (ep.silenced) this.ringVoice.setMuted(true);
    this.startVibration(ep);
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.notify(ep.alarm.label || 'Alarm', 'Rouse is ringing. Open the tab to turn it off.');
    }
    void unlockAudio().then(() => this.updateGestureButton());
  }

  private stopRingOutput(): void {
    this.ringVoice.stop();
    this.stopVibration();
    this.updateGestureButton();
  }

  private startVibration(ep: WebEpisode): void {
    this.stopVibration();
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }) : null;
    if (!ep.alarm.vibrate || !nav?.vibrate || ep.silenced) return;
    const buzz = () => {
      try {
        nav.vibrate?.(500);
      } catch {
        /* ignore */
      }
    };
    buzz();
    this.vibrateTimer = setInterval(buzz, 1000);
  }

  private stopVibration(): void {
    if (this.vibrateTimer) clearInterval(this.vibrateTimer);
    this.vibrateTimer = null;
    try {
      (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(0);
    } catch {
      /* ignore */
    }
  }

  private notify(title: string, body: string): void {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body, tag: 'rouse' });
    } catch {
      /* best effort */
    }
  }

  /** "Tap to start sound": shown while ringing if the browser blocked autoplay. Not in e2e. */
  private updateGestureButton(): void {
    if (typeof document === 'undefined' || this.options.testHooks) return;
    const ep = this.state.episode;
    const need = !!ep && ep.state === 'ringing' && !ep.silenced && audioAvailable() && audioBlocked();
    if (need && !this.gestureButton) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-primary sound-gesture';
      b.textContent = 'Tap to start sound';
      b.addEventListener('click', () => {
        void unlockAudio().then(() => this.updateGestureButton());
      });
      document.body.appendChild(b);
      this.gestureButton = b;
    } else if (!need && this.gestureButton) {
      this.gestureButton.remove();
      this.gestureButton = null;
    }
  }

  // ── ring session API ──────────────────────────────────────────────────────

  async getActiveRing(): Promise<ActiveRing | null> {
    this.check();
    return this.publicRing(this.state.episode);
  }

  async missionUiReady(sessionId: string): Promise<void> {
    this.requireSession(sessionId);
  }

  private requireSession(sessionId: string): WebEpisode {
    const ep = this.state.episode;
    if (!ep) throw rejectWith('NO_ACTIVE_RING', 'No active ring');
    if (ep.sessionId !== sessionId) throw rejectWith('SESSION_MISMATCH', 'Not the current episode');
    return ep;
  }

  async setSilenced(sessionId: string, silenced: boolean, leaseMs: number): Promise<void> {
    const ep = this.requireSession(sessionId);
    if (ep.state !== 'ringing') return; // e.g. "I'm up" during a snooze: nothing is playing
    this.setSilencedInternal(ep, silenced, leaseMs);
    this.persist();
    this.arm();
  }

  private setSilencedInternal(ep: WebEpisode, silenced: boolean, leaseMs: number): void {
    const wasSilenced = ep.silenced;
    if (silenced) {
      ep.silenced = true;
      ep.silenceUntil = this.now() + Math.max(0, Math.min(leaseMs, MAX_SILENCE_LEASE_MS));
      this.ringVoice.setMuted(true);
      this.stopVibration();
    } else {
      ep.silenced = false;
      ep.silenceUntil = null;
      // Lease expiry or explicit resume: full target volume, no ramp.
      this.ringVoice.play(this.recipeFor(ep.alarm.sound), { volume: ep.alarm.volume / 100, rampSec: 0, loop: true });
      this.startVibration(ep);
    }
    if (wasSilenced !== ep.silenced) this.emit({ type: 'ring-state', ring: this.publicRing(ep) });
    this.updateGestureButton();
  }

  async snooze(sessionId: string): Promise<{ snoozeUntil: EpochMs }> {
    const ep = this.requireSession(sessionId);
    if (ep.state !== 'ringing') throw rejectWith('NO_ACTIVE_RING', 'Not ringing');
    const sz = ep.alarm.snooze;
    if (!sz.enabled || ep.snoozeCount >= sz.maxCount || ep.source === 'wake-check') {
      throw rejectWith('SNOOZE_NOT_ALLOWED', 'Snooze not allowed');
    }
    const now = this.now();
    this.stopRingOutput();
    ep.snoozeCount += 1;
    ep.state = 'snoozed';
    ep.snoozeUntil = now + sz.intervalMin * 60_000;
    ep.ringStartedAt = null;
    ep.silenced = false;
    ep.silenceUntil = null;
    if (!ep.isTest) this.log({ type: 'snoozed', sessionId, alarmId: ep.alarmId, snoozeCount: ep.snoozeCount, snoozeUntil: ep.snoozeUntil });
    this.emit({ type: 'ring-state', ring: this.publicRing(ep) });
    this.persist();
    this.flushLog();
    this.arm();
    return { snoozeUntil: ep.snoozeUntil };
  }

  async dismiss(token: DismissToken): Promise<DismissResult> {
    const ep = this.requireSession(token.sessionId);
    // 'snoozed' is accepted for the snoozed screen's "I'm up: turn it off" (mission chain, then dismiss).
    if (ep.state !== 'ringing' && ep.state !== 'snoozed') throw rejectWith('NO_ACTIVE_RING', 'Not ringing');
    const now = this.now();
    this.stopRingOutput();
    let wakeCheckAt: EpochMs | null = null;
    if (ep.isTest) {
      this.state.episode = null;
      this.emit({ type: 'ring-state', ring: null });
    } else {
      const wc = ep.alarm.wakeUpCheck;
      if (wc.enabled && ep.wakeCheckReRings < WAKE_CHECK_MAX_RERINGS) {
        wakeCheckAt = now + wc.delayMin * 60_000;
        ep.state = 'wake-check-wait';
        ep.wakeCheckAt = wakeCheckAt;
        ep.ringStartedAt = null;
        ep.snoozeUntil = null;
        ep.silenced = false;
        ep.silenceUntil = null;
        this.log({ type: 'dismissed', sessionId: ep.sessionId, alarmId: ep.alarmId, via: token.via, wakeCheckAt });
        this.emit({ type: 'ring-state', ring: this.publicRing(ep) });
      } else {
        this.log({ type: 'dismissed', sessionId: ep.sessionId, alarmId: ep.alarmId, via: token.via, wakeCheckAt: null });
        this.log({ type: 'episode-ended', sessionId: ep.sessionId, alarmId: ep.alarmId, reason: 'dismissed' });
        this.state.episode = null;
        this.emit({ type: 'ring-state', ring: null });
      }
    }
    this.persist();
    this.flushLog();
    this.arm();
    return { wakeCheckAt };
  }

  async confirmAwake(sessionId: string): Promise<void> {
    const ep = this.requireSession(sessionId);
    if (ep.state !== 'wake-check-wait' && ep.state !== 'wake-check-prompt') throw rejectWith('NO_ACTIVE_RING', 'No wake-up check');
    this.previewVoice.stop();
    this.log({ type: 'wake-check-confirmed', sessionId, alarmId: ep.alarmId });
    this.log({ type: 'episode-ended', sessionId, alarmId: ep.alarmId, reason: 'wake-check-confirmed' });
    this.state.episode = null;
    this.emit({ type: 'ring-state', ring: null });
    this.persist();
    this.flushLog();
    this.arm();
  }

  async testAlarm(alarm: Alarm, delaySeconds: number): Promise<{ fireAt: EpochMs }> {
    const delay = Math.max(1, Math.min(3600, Math.round(delaySeconds)));
    const fireAt = this.now() + delay * 1000;
    this.state.test = { alarm: JSON.parse(JSON.stringify(alarm)) as Alarm, fireAt };
    this.persist();
    this.arm();
    return { fireAt };
  }

  async getPendingTest(): Promise<{ fireAt: EpochMs } | null> {
    this.check(); // a test that is due has fired by now
    const t = this.state.test;
    return t ? { fireAt: t.fireAt } : null;
  }

  async cancelTest(): Promise<void> {
    const s = this.state;
    s.test = null;
    const ep = s.episode;
    if (ep?.isTest) {
      // Same outcome as dismissing a test ring: no log events, no stats, no wake check (D-030, D-053).
      this.stopRingOutput();
      s.episode = null;
      this.emit({ type: 'ring-state', ring: null });
    }
    this.persist();
    this.arm();
  }

  // ── log ───────────────────────────────────────────────────────────────────

  async getLog(afterSeq: number): Promise<AlarmLogEvent[]> {
    return this.state.log.filter((e) => e.seq > afterSeq && e.seq > this.state.ackedThrough).map((e) => ({ ...e }));
  }

  async ackLog(throughSeq: number): Promise<void> {
    this.state.ackedThrough = Math.max(this.state.ackedThrough, throughSeq);
    this.persist();
  }

  // ── health ────────────────────────────────────────────────────────────────

  async getHealth(): Promise<HealthStatus> {
    const na = (id: HealthCheckId, severity: HealthCheck['severity'], detail: string): HealthCheck => ({
      id,
      state: 'unsupported',
      severity,
      fix: 'none',
      detail,
    });
    let notif: HealthCheck;
    if (typeof Notification === 'undefined') {
      notif = na('notifications', 'critical', 'This browser has no notifications.');
    } else if (Notification.permission === 'granted') {
      notif = { id: 'notifications', state: 'ok', severity: 'critical', fix: 'none', detail: 'Notifications are allowed for this tab.' };
    } else if (Notification.permission === 'denied') {
      notif = { id: 'notifications', state: 'action-needed', severity: 'critical', fix: 'open-settings', detail: 'Notifications are blocked in this browser.' };
    } else {
      notif = { id: 'notifications', state: 'action-needed', severity: 'critical', fix: 'request-permission', detail: 'Allow notifications to see the alarm when the tab is in the background.' };
    }
    let camera: HealthCheck = { id: 'camera', state: 'unknown', severity: 'optional', fix: 'request-permission', detail: 'Camera access is asked when you scan a code.' };
    try {
      const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
      if (perms?.query) {
        const st = await perms.query({ name: 'camera' as PermissionName });
        camera =
          st.state === 'granted'
            ? { ...camera, state: 'ok', fix: 'none', detail: 'Camera allowed.' }
            : st.state === 'denied'
              ? { ...camera, state: 'action-needed', fix: 'open-settings', detail: 'Camera is blocked in this browser.' }
              : camera;
      }
    } catch {
      /* keep unknown */
    }
    const hasMotion = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
    return {
      platform: 'web',
      sdkInt: null,
      manufacturer: null,
      checkedAt: this.now(),
      checks: [
        na('exactAlarm', 'critical', 'Web pages cannot schedule exact system alarms.'),
        notif,
        na('fullScreenIntent', 'critical', 'Web pages cannot show a full-screen alarm over the lock screen.'),
        na('displayOverApps', 'recommended', 'Web pages cannot open over other apps.'),
        na('batteryOptimization', 'recommended', 'Not applicable to the web demo.'),
        na('backgroundRestricted', 'recommended', 'Not applicable to the web demo.'),
        na('dndAllowsAlarms', 'recommended', 'Not applicable to the web demo.'),
        na('alarmVolume', 'recommended', 'Uses this tab’s audio volume.'),
        camera,
        {
          id: 'motionSensors',
          state: hasMotion ? 'unknown' : 'unsupported',
          severity: 'optional',
          fix: 'none',
          detail: hasMotion ? 'Motion sensors are used if the device has them.' : 'No motion sensors in this browser.',
        },
        na('lockedDevice', 'critical', "This web demo can't wake a locked phone or ring when the tab is closed."),
      ],
    };
  }

  async requestFix(id: HealthCheckId): Promise<FixOutcome> {
    if (id === 'notifications' && typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') return 'already-ok';
      try {
        const p = await Notification.requestPermission();
        return p === 'granted' ? 'granted' : 'denied';
      } catch {
        return 'denied';
      }
    }
    if (id === 'camera' && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t) => t.stop());
        return 'granted';
      } catch {
        return 'denied';
      }
    }
    return 'unsupported';
  }

  // ── diagnostics ───────────────────────────────────────────────────────────

  async getDiagnostics(): Promise<string> {
    this.check();
    const s = this.state;
    const unavailable: string[] = [];
    let health: HealthStatus | null = null;
    try {
      health = await this.getHealth();
    } catch {
      unavailable.push('health');
    }
    const facts = [`user agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`, `alarms mirrored: ${s.alarms.length}`];
    // Log events carry ids, never labels; list the most recent kinds only.
    const recent = s.log.slice(-20).map((e) => `${new Date(e.at).toISOString()} #${e.seq} ${e.type}`);
    return formatDiagnostics({
      platform: 'web',
      generatedAt: this.now(),
      health,
      next: s.scheduled,
      ring: this.publicRing(s.episode),
      pendingTestAt: s.test?.fireAt ?? null,
      facts,
      lines: recent,
      unavailable,
    });
  }

  // ── sounds ────────────────────────────────────────────────────────────────

  async listSounds(): Promise<SoundInfo[]> {
    return BUNDLED_SOUNDS.map((s) => ({ ref: { kind: 'bundled', id: s.id }, name: s.name, durationMs: s.recipe.loopMs }));
  }

  async previewSound(sound: SoundRef, volume: number): Promise<void> {
    if (this.state.episode?.state === 'ringing') return; // never preview over a real ring
    await unlockAudio();
    this.previewing = true;
    this.previewVoice.play(this.recipeFor(sound), { volume: Math.max(10, Math.min(100, volume)) / 100, loop: true, maxMs: 15_000 });
  }

  async stopPreview(): Promise<void> {
    this.previewing = false;
    this.previewVoice.stop();
  }

  async pickCustomSound(): Promise<SoundInfo | null> {
    return null;
  }

  async deleteCustomSound(_id: string): Promise<void> {
    void _id;
  }

  // ── test hooks ────────────────────────────────────────────────────────────

  private installTestHooks(): void {
    const hooks: RouseTestHooks = {
      ringNow: async (alarmId: string) => {
        const alarm = this.state.alarms.find((a) => a.id === alarmId);
        if (!alarm) throw rejectWith('INVALID_ARGUMENT', `Unknown alarm ${alarmId}`);
        const now = this.now();
        const sessionId = this.fireAlarms([alarm], now, now);
        this.reschedule(now);
        this.persist();
        this.flushLog();
        this.arm();
        return sessionId;
      },
      fireNextTimer: async () => {
        const next = this.pendingTimers().find((t) => t.kind === 'snooze' || t.kind === 'wake-check' || t.kind === 'wake-check-deadline' || t.kind === 'test');
        if (next) this.fireTimer(next.kind, this.now());
        this.persist();
        this.flushLog();
        this.arm();
      },
      injectScan: (text: string) => {
        window.dispatchEvent(new CustomEvent(TEST_SCAN_EVENT, { detail: text }));
      },
      inspect: () => {
        const ep = this.state.episode;
        const audio: 'playing' | 'silenced' | 'stopped' = ep && ep.state === 'ringing' ? (ep.silenced ? 'silenced' : 'playing') : 'stopped';
        return {
          ring: this.publicRing(ep),
          audio,
          timers: this.pendingTimers(),
          log: this.state.log.map((e) => ({ ...e })),
        };
      },
    };
    window.__rouseTest = hooks;
  }

  /** For unit tests. */
  get isPreviewing(): boolean {
    return this.previewing;
  }
}

export function createWebAlarmBackend(options: WebAlarmBackendOptions = {}): AlarmBackend {
  return new WebAlarmBackend(options);
}
