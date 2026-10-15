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
 */
import type { ActiveRing, AlarmBackend } from '../platform/AlarmBackend';
import type { Alarm, EpochMs, MissionConfig, RingSession, Settings } from './types';
import type { Rng } from '../missions/rng';
import { notImplemented } from './notImplemented';

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

/**
 * Resolve the dismissal plan: randomMission substitution (non-QR slots → random randomEligible type
 * with default config; empty → one random), then any mission whose MISSION_META.requires is not met
 * by `caps` is replaced by settings.fallback.mission. Empty result = "no-mission" alarm.
 */
export function resolveMissionPlan(alarm: Alarm, settings: Settings, caps: DeviceCapabilities, rng: Rng): MissionConfig[] {
  return notImplemented(`resolveMissionPlan(${alarm.id}, ${typeof settings}, ${JSON.stringify(caps)}, ${typeof rng})`);
}

/**
 * New session for a ring. `restored` (same sessionId, from Repository.loadRingProgress) is used ONLY
 * when ring.source === 'safety' (crash/kill recovery, D-015): completed missions are kept, the current
 * mission restarts with a fresh puzzle, phase resets to 'alerting'. Snooze returns and wake-check
 * re-rings always start fresh.
 */
export function createRingSession(ring: ActiveRing, plan: MissionConfig[], now: EpochMs, restored?: RingSession | null): RingSession {
  return notImplemented(`createRingSession(${ring.sessionId}, ${plan.length}, ${now}, ${restored?.sessionId})`);
}

/** Snoozes remaining (0 if snooze disabled or ring source is 'wake-check'). */
export function snoozesLeft(session: RingSession): number {
  return notImplemented(`snoozesLeft(${session.sessionId})`);
}

/** Mission currently on screen (fallback mission if fallbackActive), or null when not solving. */
export function currentMission(session: RingSession, settings: Settings): MissionConfig | null {
  return notImplemented(`currentMission(${session.sessionId}, ${typeof settings})`);
}

/** failedAttempts >= fallback.afterFailures OR now − missionStartedAt >= afterMinutes; never while fallbackActive. */
export function isFallbackOffered(session: RingSession, settings: Settings, now: EpochMs): boolean {
  return notImplemented(`isFallbackOffered(${session.sessionId}, ${typeof settings}, ${now})`);
}

export class RingController {
  constructor(ring: ActiveRing, deps: RingControllerDeps, restored?: RingSession | null) {
    notImplemented(`RingController(${ring.sessionId}, ${typeof deps}, ${restored?.sessionId})`);
  }
  getSession(): Readonly<RingSession> {
    return notImplemented('RingController.getSession');
  }
  subscribe(listener: (session: Readonly<RingSession>) => void): () => void {
    return notImplemented(`RingController.subscribe(${typeof listener})`);
  }
  /** Ring screen rendered → backend.missionUiReady. */
  uiReady(): Promise<void> {
    return notImplemented('RingController.uiReady');
  }
  /** Plan empty → dismiss immediately with via 'no-mission'. */
  startMission(): void {
    notImplemented('RingController.startMission');
  }
  requestSnooze(): Promise<void> {
    return notImplemented('RingController.requestSnooze');
  }
  cancelSnoozeMission(): void {
    notImplemented('RingController.cancelSnoozeMission');
  }
  /** Any user interaction in a mission (keypress, tap, motion rep). */
  activity(): void {
    notImplemented('RingController.activity');
  }
  missionSucceeded(): Promise<void> {
    return notImplemented('RingController.missionSucceeded');
  }
  /** A wrong answer / wrong code / failed round. `reason` is for diagnostics only. */
  missionFailed(reason?: string): void {
    notImplemented(`RingController.missionFailed(${reason})`);
  }
  acceptFallback(): void {
    notImplemented('RingController.acceptFallback');
  }
  /** Feed backend ring-state events in. */
  applyRing(ring: ActiveRing | null): void {
    notImplemented(`RingController.applyRing(${ring?.sessionId})`);
  }
  dispose(): void {
    notImplemented('RingController.dispose');
  }
}
