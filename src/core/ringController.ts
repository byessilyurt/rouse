/**
 * RingController — the dismissal rule (D-004). OWNER: core agent. API is part of the contract.
 *
 * One instance per ringing episode, created by the UI's #/ring route from an ActiveRing.
 * It is the ONLY code that calls backend.dismiss (it mints the DismissToken).
 *
 * State machine (RingSession.phase):
 *   alerting ──startMission()──────────────────────────────▶ solving(purpose=dismiss)
 *   alerting ──requestSnooze() [canSnooze, !requireMission]─▶ snoozed            (backend.snooze)
 *   alerting ──requestSnooze() [canSnooze, requireMission]──▶ solving(purpose=snooze, plan[0])
 *   solving  ──missionSucceeded() [dismiss, more left]─────▶ solving(missionIndex+1)
 *   solving  ──missionSucceeded() [dismiss, last]──────────▶ completing ──backend.dismiss──▶ dismissed
 *   solving  ──missionSucceeded() [snooze]─────────────────▶ snoozed            (backend.snooze)
 *   solving  ──missionFailed()────────────────────────────▶ solving(failedAttempts+1)
 *   solving  ──acceptFallback() [isFallbackOffered]───────▶ solving(fallbackActive, same index)
 *   solving  ──cancelSnoozeMission() [purpose=snooze]─────▶ alerting
 *   any      ──applyRing(null | state≠'ringing')──────────▶ ended
 *
 * Silence while solving: entering 'solving' and every activity() (throttled to
 * SILENCE_RENEW_THROTTLE_MS) call backend.setSilenced(id, true, silenceWhileSolvingSec*1000).
 * A local idle timer of the same length flips `silenced` to false (native resumes on its own).
 * Leaving 'solving' calls setSilenced(id, false, 0).
 *
 * Implementation notes (behaviour the diagram leaves open):
 *  - cancelSnoozeMission() also works for a DISMISS mission ("Back to alarm" in design.md §3.7):
 *    the sound resumes and completed missions are kept.
 *  - Leaving 'solving' for 'completing'/'snoozed' does NOT unsilence first: the backend stops the
 *    sound anyway, and un-muting for a few ms before dismissal would blast the user. If the
 *    dismiss/snooze call fails, the controller returns to 'alerting' and unsilences then.
 *  - A failed backend.dismiss/backend.snooze returns to 'alerting' (progress kept) and the error is
 *    re-thrown from the async method so the UI can tell the user.
 *  - missionFailed(MISSION_UNAVAILABLE) (camera/sensor died mid-mission) unlocks the fallback at once.
 */
import type { ActiveRing, AlarmBackend, DismissToken } from '../platform/AlarmBackend';
import type { Alarm, DismissVia, EpochMs, MissionConfig, MissionType, RingSession, Settings } from './types';
import { MAX_SILENCE_LEASE_MS, MISSION_META, MISSION_TYPES, SILENCE_RENEW_THROTTLE_MS, defaultMissionConfig } from './defaults';
import type { Rng } from '../missions/rng';
import { shuffle } from '../missions/rng';

export interface DeviceCapabilities {
  /** devicemotion delivers data (probed by the UI). */
  motion: boolean;
  /** Camera permission granted and a camera exists. */
  camera: boolean;
}

export interface TimerApi {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface RingControllerDeps {
  backend: Pick<AlarmBackend, 'snooze' | 'dismiss' | 'setSilenced' | 'missionUiReady'>;
  settings: Settings;
  now: () => EpochMs;
  rng: Rng;
  capabilities: DeviceCapabilities;
  /** Default: setTimeout/clearTimeout. */
  timers?: TimerApi;
  /** Called after every state change (Repository.saveRingProgress). */
  persist?: (session: RingSession) => void;
  /** Called once when a terminal phase is reached (RouseService.recordRingOutcome). */
  onFinished?: (session: RingSession) => void;
}

/** Pass as missionFailed(reason) when the mission cannot run at all (camera denied, sensor silent). */
export const MISSION_UNAVAILABLE = 'unavailable';

const defaultTimers: TimerApi = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function isAvailable(type: MissionType, caps: DeviceCapabilities): boolean {
  return MISSION_META[type].requires.every((req) => caps[req]);
}

/** Replace missions whose device requirements are not met by the fallback mission. */
function applyCapabilities(plan: readonly MissionConfig[], settings: Settings, caps: DeviceCapabilities): MissionConfig[] {
  return plan.map((m) => (isAvailable(m.type, caps) ? clone(m) : clone(settings.fallback.mission)));
}

/**
 * Resolve the dismissal plan: randomMission substitution (non-QR slots → random randomEligible type
 * with default config; empty → one random), then any mission whose MISSION_META.requires is not met
 * by `caps` is replaced by settings.fallback.mission. Empty result = "no-mission" alarm.
 */
export function resolveMissionPlan(alarm: Alarm, settings: Settings, caps: DeviceCapabilities, rng: Rng): MissionConfig[] {
  let plan: MissionConfig[] = clone(alarm.missions);
  if (alarm.randomMission) {
    // Only types that can actually run here; prefer not repeating a type within one plan.
    const eligible = MISSION_TYPES.filter((t) => MISSION_META[t].randomEligible && isAvailable(t, caps));
    const pool = eligible.length > 0 ? eligible : MISSION_TYPES.filter((t) => MISSION_META[t].randomEligible);
    let bag: MissionType[] = [];
    const draw = (): MissionType => {
      if (bag.length === 0) bag = shuffle(rng, pool);
      return bag.pop() as MissionType;
    };
    const slots = plan.length === 0 ? [null] : plan;
    plan = slots.map((m) => (m !== null && m.type === 'qr' ? m : defaultMissionConfig(draw())));
  }
  return applyCapabilities(plan, settings, caps);
}

/**
 * New session for a ring. `restored` (same sessionId, from Repository.loadRingProgress) is used ONLY
 * when ring.source === 'safety' (crash/kill recovery, D-015): completed missions are kept, the current
 * mission restarts with a fresh puzzle, phase resets to 'alerting'. Snooze returns and wake-check
 * re-rings always start fresh.
 */
export function createRingSession(ring: ActiveRing, plan: MissionConfig[], now: EpochMs, restored?: RingSession | null): RingSession {
  const session: RingSession = {
    sessionId: ring.sessionId,
    alarmId: ring.alarmId,
    alarm: clone(ring.alarm),
    source: ring.source,
    episodeStartedAt: ring.episodeStartedAt,
    ringStartedAt: ring.ringStartedAt ?? now,
    snoozeCount: ring.snoozeCount,
    phase: 'alerting',
    purpose: null,
    plan: clone(plan),
    missionIndex: 0,
    failedAttempts: 0,
    totalFailedAttempts: 0,
    fallbackActive: false,
    usedFallback: false,
    missionStartedAt: null,
    missionTimeMs: 0,
    silenced: false,
    lastActivityAt: null,
  };
  if (!restored || ring.source !== 'safety' || restored.sessionId !== ring.sessionId) return session;
  const index = Number.isInteger(restored.missionIndex) ? restored.missionIndex : 0;
  return {
    ...session,
    missionIndex: Math.min(Math.max(0, index), plan.length),
    // The current mission restarts with a fresh puzzle, but earned fallback progress is kept.
    failedAttempts: restored.failedAttempts ?? 0,
    totalFailedAttempts: restored.totalFailedAttempts ?? 0,
    fallbackActive: restored.purpose === 'dismiss' || restored.purpose === null ? restored.fallbackActive === true : false,
    usedFallback: restored.usedFallback === true,
    missionTimeMs: restored.missionTimeMs ?? 0,
  };
}

/** Snoozes remaining (0 if snooze disabled or ring source is 'wake-check'). */
export function snoozesLeft(session: RingSession): number {
  if (!session.alarm.snooze.enabled || session.source === 'wake-check') return 0;
  return Math.max(0, session.alarm.snooze.maxCount - session.snoozeCount);
}

/** Mission currently on screen (fallback mission if fallbackActive), or null when not solving. */
export function currentMission(session: RingSession, settings: Settings): MissionConfig | null {
  if (session.phase !== 'solving') return null;
  if (session.fallbackActive) return settings.fallback.mission;
  const index = session.purpose === 'snooze' ? 0 : session.missionIndex;
  return session.plan[index] ?? null;
}

/** failedAttempts >= fallback.afterFailures OR now − missionStartedAt >= afterMinutes; never while fallbackActive. */
export function isFallbackOffered(session: RingSession, settings: Settings, now: EpochMs): boolean {
  if (session.phase !== 'solving' || session.fallbackActive) return false;
  if (session.failedAttempts >= settings.fallback.afterFailures) return true;
  return session.missionStartedAt !== null && now - session.missionStartedAt >= settings.fallback.afterMinutes * 60_000;
}

const TERMINAL: ReadonlySet<RingSession['phase']> = new Set(['snoozed', 'dismissed', 'ended']);

export class RingController {
  private session: RingSession;
  private readonly deps: RingControllerDeps;
  private readonly timers: TimerApi;
  private readonly listeners = new Set<(session: Readonly<RingSession>) => void>();
  private idleTimer: unknown = null;
  private offerTimer: unknown = null;
  private lastRenewAt = -Infinity;
  /** A snooze or dismiss call is in flight. */
  private busy = false;
  /** Latest ring event received while busy (undefined = none); applied if the call fails. */
  private pendingRing: ActiveRing | null | undefined = undefined;
  /** Dismiss-mission fallback progress, parked while a snooze mission is on screen. */
  private parkedProgress: { failedAttempts: number; fallbackActive: boolean } | null = null;
  private finished = false;
  private disposed = false;

  constructor(ring: ActiveRing, deps: RingControllerDeps, restored?: RingSession | null) {
    this.deps = deps;
    this.timers = deps.timers ?? defaultTimers;
    const now = deps.now();
    // The plan is fixed for the whole episode: reuse it when we have one for this session (snooze
    // return, re-ring), re-checking capabilities in case e.g. camera permission was revoked.
    const sameEpisode = restored && restored.sessionId === ring.sessionId && Array.isArray(restored.plan);
    const plan = sameEpisode
      ? applyCapabilities(restored.plan, deps.settings, deps.capabilities)
      : resolveMissionPlan(ring.alarm, deps.settings, deps.capabilities, deps.rng);
    this.session = createRingSession(ring, plan, now, restored);
    this.persist();
  }

  getSession(): Readonly<RingSession> {
    return this.session;
  }

  subscribe(listener: (session: Readonly<RingSession>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Ring screen rendered → backend.missionUiReady. */
  uiReady(): Promise<void> {
    return this.deps.backend.missionUiReady(this.session.sessionId);
  }

  /** Plan empty → dismiss immediately with via 'no-mission'. */
  startMission(): void {
    if (!this.canAct() || this.session.phase !== 'alerting') return;
    const s = this.session;
    if (s.plan.length === 0) {
      void this.complete('no-mission').catch(() => undefined);
      return;
    }
    if (s.missionIndex >= s.plan.length) {
      // Every mission was already passed (e.g. a dismiss call failed earlier): just retry dismissal.
      void this.complete(s.usedFallback ? 'fallback' : 'mission').catch(() => undefined);
      return;
    }
    this.enterSolving('dismiss');
  }

  async requestSnooze(): Promise<void> {
    if (!this.canAct() || this.session.phase !== 'alerting' || snoozesLeft(this.session) <= 0) return;
    if (this.session.alarm.snooze.requireMission && this.session.plan.length > 0) {
      this.enterSolving('snooze');
      return;
    }
    await this.snooze();
  }

  cancelSnoozeMission(): void {
    if (!this.canAct() || this.session.phase !== 'solving') return;
    this.returnToAlerting(true);
  }

  /** Any user interaction in a mission (keypress, tap, motion rep). */
  activity(): void {
    if (!this.canAct() || this.session.phase !== 'solving') return;
    const now = this.deps.now();
    if (this.session.silenced && now - this.lastRenewAt < SILENCE_RENEW_THROTTLE_MS) {
      // Throttled: remember the interaction without a storage write or a re-render.
      this.session = { ...this.session, lastActivityAt: now };
      return;
    }
    this.renewSilence(now);
    this.update({ lastActivityAt: now, silenced: true });
  }

  async missionSucceeded(): Promise<void> {
    if (!this.canAct() || this.session.phase !== 'solving') return;
    const s = this.session;
    this.accrueMissionTime();
    if (s.purpose === 'snooze') {
      await this.snooze();
      return;
    }
    const nextIndex = s.missionIndex + 1;
    if (nextIndex < s.plan.length) {
      const now = this.deps.now();
      this.update({ missionIndex: nextIndex, failedAttempts: 0, fallbackActive: false, missionStartedAt: now, lastActivityAt: now });
      this.renewSilence(now);
      this.update({ silenced: true });
      this.armOfferTimer();
      return;
    }
    this.update({ missionIndex: s.plan.length, fallbackActive: false, missionStartedAt: null });
    await this.complete(this.session.usedFallback ? 'fallback' : 'mission');
  }

  /** A wrong answer / wrong code / failed round. `reason` is for diagnostics only. */
  missionFailed(reason?: string): void {
    if (!this.canAct() || this.session.phase !== 'solving') return;
    const s = this.session;
    const failedAttempts =
      reason === MISSION_UNAVAILABLE && !s.fallbackActive
        ? Math.max(s.failedAttempts + 1, this.deps.settings.fallback.afterFailures)
        : s.failedAttempts + 1;
    this.update({ failedAttempts, totalFailedAttempts: s.totalFailedAttempts + 1 });
    this.activity();
  }

  acceptFallback(): void {
    if (!this.canAct() || !isFallbackOffered(this.session, this.deps.settings, this.deps.now())) return;
    this.accrueMissionTime();
    const now = this.deps.now();
    this.clearOfferTimer();
    this.update({ fallbackActive: true, usedFallback: true, failedAttempts: 0, missionStartedAt: now, lastActivityAt: now });
    this.renewSilence(now);
    this.update({ silenced: true });
  }

  /** Feed backend ring-state events in. */
  applyRing(ring: ActiveRing | null): void {
    if (this.disposed || TERMINAL.has(this.session.phase)) return;
    if (this.busy) {
      // Our own dismiss/snooze is in flight and its state change usually arrives here first:
      // let the pending call decide the terminal phase, and replay this event only if it fails.
      this.pendingRing = ring;
      return;
    }
    const mine = ring !== null && ring.sessionId === this.session.sessionId;
    if (mine && ring.state === 'ringing') {
      const patch: Partial<RingSession> = {};
      if (ring.snoozeCount !== this.session.snoozeCount) patch.snoozeCount = ring.snoozeCount;
      // The native lease ran out (or was never applied): our "silenced" view must follow.
      if (!ring.silenced && this.session.silenced) {
        patch.silenced = false;
        this.clearIdleTimer();
        this.lastRenewAt = -Infinity;
      }
      if (Object.keys(patch).length > 0) this.update(patch);
      return;
    }
    this.accrueMissionTime();
    this.clearTimers();
    this.update({ phase: 'ended', purpose: null, missionStartedAt: null, silenced: false });
    this.finish();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.listeners.clear();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private canAct(): boolean {
    return !this.disposed && !this.busy && !TERMINAL.has(this.session.phase);
  }

  private get leaseMs(): number {
    return Math.min(MAX_SILENCE_LEASE_MS, Math.max(1, this.deps.settings.silenceWhileSolvingSec) * 1000);
  }

  private enterSolving(purpose: 'dismiss' | 'snooze'): void {
    const now = this.deps.now();
    const s = this.session;
    // A dismiss mission keeps its failure count / fallback across "Back to alarm"; a snooze mission
    // starts clean and parks the dismiss progress until it is cancelled.
    if (purpose === 'snooze') this.parkedProgress = { failedAttempts: s.failedAttempts, fallbackActive: s.fallbackActive };
    this.update({
      phase: 'solving',
      purpose,
      failedAttempts: purpose === 'snooze' ? 0 : s.failedAttempts,
      fallbackActive: purpose === 'snooze' ? false : s.fallbackActive,
      missionStartedAt: now,
      lastActivityAt: now,
    });
    this.renewSilence(now);
    this.update({ silenced: true });
    this.armOfferTimer();
  }

  /** Ask the backend to mute for one lease and restart the local idle timer. */
  private renewSilence(now: EpochMs): void {
    this.lastRenewAt = now;
    this.deps.backend.setSilenced(this.session.sessionId, true, this.leaseMs).catch(() => undefined);
    this.clearIdleTimer();
    this.idleTimer = this.timers.set(() => {
      this.idleTimer = null;
      if (this.disposed || this.session.phase !== 'solving') return;
      // Native has resumed on its own (D-017); the next activity() renews immediately.
      this.lastRenewAt = -Infinity;
      this.update({ silenced: false });
    }, this.leaseMs);
  }

  /** Leave silence: optionally tell the backend to resume now. */
  private stopSilence(resume: boolean): void {
    this.clearIdleTimer();
    this.clearOfferTimer();
    this.lastRenewAt = -Infinity;
    if (resume) this.deps.backend.setSilenced(this.session.sessionId, false, 0).catch(() => undefined);
  }

  /** Re-render when the time-based fallback offer unlocks, so the UI need not poll. */
  private armOfferTimer(): void {
    this.clearOfferTimer();
    const s = this.session;
    if (s.missionStartedAt === null || s.fallbackActive) return;
    const due = s.missionStartedAt + this.deps.settings.fallback.afterMinutes * 60_000 - this.deps.now();
    this.offerTimer = this.timers.set(
      () => {
        this.offerTimer = null;
        if (!this.disposed && this.session.phase === 'solving') this.emit();
      },
      Math.max(0, due),
    );
  }

  private accrueMissionTime(): void {
    const s = this.session;
    if (s.missionStartedAt === null) return;
    const elapsed = Math.max(0, this.deps.now() - s.missionStartedAt);
    this.session = { ...s, missionTimeMs: s.missionTimeMs + elapsed, missionStartedAt: this.deps.now() };
  }

  private async snooze(): Promise<void> {
    const wasSolving = this.session.phase === 'solving';
    this.busy = true;
    this.pendingRing = undefined;
    try {
      await this.deps.backend.snooze(this.session.sessionId);
    } catch (err) {
      this.afterFailedCall(wasSolving);
      throw err;
    }
    this.busy = false;
    if (this.disposed) return;
    this.clearTimers();
    this.update({ phase: 'snoozed', purpose: null, missionStartedAt: null, silenced: false, fallbackActive: false });
    this.finish();
  }

  private async complete(via: DismissVia): Promise<void> {
    const wasSolving = this.session.phase === 'solving';
    this.clearOfferTimer();
    this.update({ phase: 'completing', purpose: null, missionStartedAt: null });
    this.busy = true;
    this.pendingRing = undefined;
    // The ONLY place a DismissToken is minted.
    const token = { sessionId: this.session.sessionId, via } as DismissToken;
    try {
      await this.deps.backend.dismiss(token);
    } catch (err) {
      this.afterFailedCall(wasSolving);
      throw err;
    }
    this.busy = false;
    if (this.disposed) return;
    this.clearTimers();
    this.update({ phase: 'dismissed', silenced: false });
    this.finish();
  }

  /** A snooze/dismiss call was rejected: back to the alarm face, then replay any parked ring event. */
  private afterFailedCall(resume: boolean): void {
    this.busy = false;
    if (this.disposed) return;
    this.returnToAlerting(resume);
    const pending = this.pendingRing;
    this.pendingRing = undefined;
    if (pending !== undefined) this.applyRing(pending);
  }

  /** solving/completing → alerting. Completed missions are kept; the sound resumes if `resume`. */
  private returnToAlerting(resume: boolean): void {
    if (TERMINAL.has(this.session.phase)) return;
    this.accrueMissionTime();
    const wasSnoozeMission = this.session.purpose === 'snooze';
    const parked = wasSnoozeMission ? this.parkedProgress : null;
    this.parkedProgress = null;
    this.update({
      phase: 'alerting',
      purpose: null,
      missionStartedAt: null,
      silenced: false,
      ...(wasSnoozeMission ? { failedAttempts: parked?.failedAttempts ?? 0, fallbackActive: parked?.fallbackActive ?? false } : {}),
    });
    this.stopSilence(resume);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.deps.onFinished?.(this.session);
  }

  private update(patch: Partial<RingSession>): void {
    this.session = { ...this.session, ...patch };
    this.persist();
    this.emit();
  }

  private persist(): void {
    try {
      this.deps.persist?.(this.session);
    } catch {
      // Progress persistence is best-effort (crash recovery only); never break the ring flow.
    }
  }

  private emit(): void {
    for (const l of [...this.listeners]) l(this.session);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) this.timers.clear(this.idleTimer);
    this.idleTimer = null;
  }

  private clearOfferTimer(): void {
    if (this.offerTimer !== null) this.timers.clear(this.offerTimer);
    this.offerTimer = null;
  }

  private clearTimers(): void {
    this.clearIdleTimer();
    this.clearOfferTimer();
  }
}
