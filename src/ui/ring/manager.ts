/**
 * RingManager — owns the one RingController for the current ringing episode across the ring routes
 * (#/ring, #/ring/mission/:step, #/ring/fallback). Fed by backend events and getActiveRing().
 * The UI never calls dismiss/snooze/setSilenced itself; RingController does (plan §2.2, D-004).
 */
import type { ActiveRing, AlarmBackend } from '../../platform/AlarmBackend';
import type { RouseService } from '../../core/service';
import type { Repository } from '../../core/storage';
import type { EpochMs, RingSession } from '../../core/types';
import { RingController } from '../../core/ringController';
import { randomRng } from '../../missions/rng';
import type { CapabilityStore } from '../capabilities';
import { writeUiPrefs } from '../uiPrefs';

export type TerminalKind = 'dismissed' | 'snoozed' | 'ended';
export interface FinishedInfo {
  kind: TerminalKind;
  session: RingSession;
  isTest: boolean;
  at: EpochMs;
  alarmLabel: string;
}

export interface RingManagerDeps {
  backend: AlarmBackend;
  service: RouseService;
  repo: Repository;
  caps: CapabilityStore;
  now: () => EpochMs;
}

const TERMINAL = new Set(['snoozed', 'dismissed', 'ended']);

export class RingManager {
  private ring: ActiveRing | null = null;
  private ctrl: RingController | null = null;
  private ctrlKey: string | null = null;
  private ctrlUnsub: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private terminalHandler: ((info: FinishedInfo) => void) | null = null;
  private suppressTerminal = false;
  /** Set by the snoozed screen's "I'm up" flow: the controller runs on a snoozed episode. */
  private early = false;
  lastFinished: FinishedInfo | null = null;
  /** Where "End test" / Done should return after a test ring started from the editor. */
  testReturnTo: string | null = null;
  /** A test ring was requested and is expected shortly. */
  testPendingSince: EpochMs | null = null;
  /** `${sessionId}|${missionIndex}` of a mission whose hardware/permission is unavailable (backup offered at once). */
  unavailableKey: string | null = null;

  constructor(private readonly deps: RingManagerDeps) {}

  getRing(): ActiveRing | null {
    return this.ring;
  }
  getController(): RingController | null {
    return this.ctrl;
  }
  getSession(): Readonly<RingSession> | null {
    return this.ctrl ? this.ctrl.getSession() : null;
  }
  isEarly(): boolean {
    return this.early;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onTerminal(handler: (info: FinishedInfo) => void): void {
    this.terminalHandler = handler;
  }
  private notify() {
    for (const l of [...this.listeners]) l();
  }

  /** Feed the authoritative episode state (getActiveRing or a backend event). */
  setRing(ring: ActiveRing | null): void {
    const prev = this.ring;
    this.ring = ring;
    if (ring && ring.state === 'ringing') {
      if (ring.isTest) this.testPendingSince = null;
      const key = keyOf(ring);
      if (this.ctrl && this.ctrlKey === key) {
        this.ctrl.applyRing(ring);
      } else {
        this.early = false;
        this.createController(ring, key);
      }
    } else if (this.ctrl) {
      const phase = this.ctrl.getSession().phase;
      // An early ("I'm up") controller runs on a snoozed episode: only an ended episode stops it.
      if (!TERMINAL.has(phase) && (!this.early || ring === null || ring.sessionId !== this.ctrl.getSession().sessionId)) {
        this.ctrl.applyRing(ring);
      }
    }
    if (!ring && prev) {
      try {
        this.deps.repo.clearRingProgress(prev.sessionId);
      } catch {
        /* best effort */
      }
    }
    this.notify();
  }

  private createController(ring: ActiveRing, key: string): RingController {
    this.disposeController();
    // Same-episode progress keeps the plan fixed (snooze return, re-ring) and restores missions after a crash (safety).
    const restored = ring.isTest ? null : safe(() => this.deps.repo.loadRingProgress(ring.sessionId));
    const ctrl = new RingController(
      ring,
      {
        backend: this.deps.backend,
        settings: this.deps.service.getSettings(),
        now: this.deps.now,
        rng: randomRng(),
        capabilities: this.deps.caps.get(),
        persist: (s) => {
          if (!ring.isTest) safe(() => this.deps.repo.saveRingProgress(s));
        },
        onFinished: (s) => this.finished(s, ring),
      },
      restored,
    );
    this.ctrl = ctrl;
    this.ctrlKey = key;
    this.ctrlUnsub = ctrl.subscribe(() => this.notify());
    return ctrl;
  }

  private disposeController() {
    this.ctrlUnsub?.();
    this.ctrlUnsub = null;
    if (this.ctrl) safe(() => this.ctrl?.dispose());
    this.ctrl = null;
    this.ctrlKey = null;
  }

  private finished(s: RingSession, ring: ActiveRing) {
    const kind = (s.phase === 'dismissed' || s.phase === 'snoozed' ? s.phase : 'ended') as TerminalKind;
    safe(() => this.deps.service.recordRingOutcome(s, ring.isTest));
    const info: FinishedInfo = { kind, session: { ...s }, isTest: ring.isTest, at: this.deps.now(), alarmLabel: ring.alarm.label };
    this.lastFinished = info;
    if (kind === 'dismissed' && ring.isTest && !this.suppressTerminal) writeUiPrefs({ lastTestOkAt: info.at, pendingTestAt: null });
    if (kind === 'dismissed') this.early = false;
    if (!this.suppressTerminal) this.terminalHandler?.(info);
    this.notify();
  }

  /** Snoozed screen → "I'm up: turn it off": run the mission chain now; finishing dismisses and cancels the snooze. */
  startEarly(): RingController | null {
    const ring = this.ring;
    if (!ring || ring.state !== 'snoozed') return null;
    const now = this.deps.now();
    const asRinging: ActiveRing = { ...ring, state: 'ringing', ringStartedAt: now, source: 'snooze' };
    this.early = true;
    const ctrl = this.createController(asRinging, `early|${ring.sessionId}|${now}`);
    ctrl.startMission();
    this.notify();
    return ctrl;
  }

  /**
   * "End test": a test ring has no stats and no wake check, so it is ended through a RingController
   * whose plan is empty (DismissToken via 'no-mission'). Only ever used when ring.isTest.
   */
  async endTest(): Promise<void> {
    const ring = this.ring;
    if (!ring || !ring.isTest) return;
    this.suppressTerminal = true;
    try {
      const bare: ActiveRing = { ...ring, alarm: { ...ring.alarm, missions: [], randomMission: false } };
      const ender = new RingController(bare, {
        backend: this.deps.backend,
        settings: this.deps.service.getSettings(),
        now: this.deps.now,
        rng: randomRng(),
        capabilities: this.deps.caps.get(),
      });
      ender.startMission();
      // startMission with an empty plan dismisses; wait for the backend round-trip.
      await waitFor(() => ['dismissed', 'ended'].includes(ender.getSession().phase), 3000);
      safe(() => ender.dispose());
      this.disposeController();
      this.ring = null;
    } finally {
      this.suppressTerminal = false;
      this.notify();
    }
  }
}

function keyOf(ring: ActiveRing): string {
  return `${ring.sessionId}|${ring.ringStartedAt}|${ring.source}`;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    console.warn('[rouse] ring manager:', e);
    return null;
  }
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (cond() || Date.now() - start > timeoutMs) resolve();
      else setTimeout(tick, 20);
    };
    tick();
  });
}
