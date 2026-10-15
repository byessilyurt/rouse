import { describe, expect, it, vi } from 'vitest';
import {
  MISSION_UNAVAILABLE,
  RingController,
  createRingSession,
  currentMission,
  isFallbackOffered,
  resolveMissionPlan,
  snoozesLeft,
  type DeviceCapabilities,
  type RingControllerDeps,
} from '../../../src/core/ringController';
import { MAX_SILENCE_LEASE_MS, MISSION_META, SILENCE_RENEW_THROTTLE_MS, defaultMissionConfig, defaultSettings } from '../../../src/core/defaults';
import type { Alarm, MissionConfig, RingSession, Settings } from '../../../src/core/types';
import { createRng } from '../../../src/missions/rng';
import { FakeClock, makeAlarm, makeRing } from './testUtils';
import type { ActiveRing } from '../../../src/platform/AlarmBackend';

const ALL: DeviceCapabilities = { motion: true, camera: true };
const NONE: DeviceCapabilities = { motion: false, camera: false };
const math = defaultMissionConfig('math');
const memory = defaultMissionConfig('memory');
const qr: MissionConfig = { type: 'qr', expectedCode: 'CODE', label: 'Sink' };
const shake = defaultMissionConfig('shake');

function setup(alarmOverrides: Partial<Alarm> = {}, opts: { settings?: Settings; caps?: DeviceCapabilities; ring?: Partial<ActiveRing>; restored?: RingSession | null } = {}) {
  const clock = new FakeClock(1_000_000);
  const backend = {
    snooze: vi.fn(async (_id: string) => ({ snoozeUntil: clock.t + 300_000 })),
    dismiss: vi.fn(async (_token: unknown) => ({ wakeCheckAt: null })),
    setSilenced: vi.fn(async (_id: string, _s: boolean, _ms: number) => {}),
    missionUiReady: vi.fn(async (_id: string) => {}),
  };
  const persisted: RingSession[] = [];
  const finished: RingSession[] = [];
  const settings = opts.settings ?? defaultSettings();
  const deps: RingControllerDeps = {
    backend,
    settings,
    now: clock.now,
    rng: createRng(7),
    capabilities: opts.caps ?? ALL,
    timers: clock,
    persist: (s) => persisted.push(s),
    onFinished: (s) => finished.push(s),
  };
  const alarm = makeAlarm({ missions: [math, memory], ...alarmOverrides });
  const ring = makeRing(alarm, opts.ring);
  const rc = new RingController(ring, deps, opts.restored);
  return { rc, backend, clock, persisted, finished, settings, alarm, ring };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('resolveMissionPlan', () => {
  const s = defaultSettings();
  it('copies the alarm missions when nothing needs replacing', () => {
    const alarm = makeAlarm({ missions: [math, qr] });
    const plan = resolveMissionPlan(alarm, s, ALL, createRng(1));
    expect(plan).toEqual([math, qr]);
    expect(plan[0]).not.toBe(math);
  });
  it('replaces missions whose capability is missing by the fallback mission', () => {
    const alarm = makeAlarm({ missions: [qr, shake, math, defaultMissionConfig('steps')].slice(0, 3) });
    expect(resolveMissionPlan(alarm, s, { motion: false, camera: true }, createRng(1))).toEqual([qr, s.fallback.mission, math]);
    expect(resolveMissionPlan(alarm, s, { motion: true, camera: false }, createRng(1))).toEqual([s.fallback.mission, shake, math]);
  });
  it('random: keeps QR anchors, substitutes other slots with available eligible types, deterministic per seed', () => {
    const alarm = makeAlarm({ missions: [math, qr, math], randomMission: true });
    const a = resolveMissionPlan(alarm, s, NONE, createRng(42));
    const b = resolveMissionPlan(alarm, s, NONE, createRng(42));
    expect(a).toEqual(b);
    expect(a[1]).toEqual(s.fallback.mission); // QR kept as anchor, then replaced: no camera
    for (const m of [a[0], a[2]]) {
      expect(MISSION_META[m!.type].randomEligible).toBe(true);
      expect(MISSION_META[m!.type].requires).toEqual([]);
      expect(m).toEqual(defaultMissionConfig(m!.type));
    }
    expect(a[0]!.type).not.toBe(a[2]!.type);
  });
  it('random with empty missions picks exactly one; various seeds give various types', () => {
    const alarm = makeAlarm({ missions: [], randomMission: true });
    const types = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const plan = resolveMissionPlan(alarm, s, ALL, createRng(seed));
      expect(plan).toHaveLength(1);
      expect(plan[0]!.type).not.toBe('qr');
      types.add(plan[0]!.type);
    }
    expect(types.size).toBeGreaterThan(3);
  });
  it('empty plan for a plain alarm', () => {
    expect(resolveMissionPlan(makeAlarm({ missions: [] }), s, ALL, createRng(1))).toEqual([]);
  });
});

describe('session helpers', () => {
  const alarm = makeAlarm({ missions: [math, memory] });
  it('createRingSession starts fresh unless restoring a safety re-ring', () => {
    const ring = makeRing(alarm, { ringStartedAt: null, snoozeCount: 2 });
    const s = createRingSession(ring, [math, memory], 5);
    expect(s).toMatchObject({ phase: 'alerting', missionIndex: 0, ringStartedAt: 5, snoozeCount: 2, purpose: null, silenced: false });
    const restored: RingSession = { ...s, missionIndex: 1, totalFailedAttempts: 4, failedAttempts: 2, usedFallback: true, missionTimeMs: 999, phase: 'solving', purpose: 'dismiss', fallbackActive: true };
    expect(createRingSession(ring, [math, memory], 5, restored).missionIndex).toBe(0); // source scheduled
    const safety = createRingSession({ ...ring, source: 'safety' }, [math, memory], 5, restored);
    expect(safety).toMatchObject({ phase: 'alerting', missionIndex: 1, totalFailedAttempts: 4, failedAttempts: 2, usedFallback: true, missionTimeMs: 999, fallbackActive: true, purpose: null });
    expect(createRingSession({ ...ring, source: 'safety' }, [math], 5, { ...restored, missionIndex: 9 }).missionIndex).toBe(1);
    expect(createRingSession({ ...ring, source: 'safety' }, [math], 5, { ...restored, sessionId: 'other' }).missionIndex).toBe(0);
    expect(createRingSession({ ...ring, source: 'safety' }, [math], 5, { ...restored, purpose: 'snooze' }).fallbackActive).toBe(false);
  });
  it('snoozesLeft', () => {
    const s = createRingSession(makeRing(alarm, { snoozeCount: 1 }), [], 0);
    expect(snoozesLeft(s)).toBe(2);
    expect(snoozesLeft({ ...s, snoozeCount: 5 })).toBe(0);
    expect(snoozesLeft({ ...s, source: 'wake-check' })).toBe(0);
    expect(snoozesLeft({ ...s, alarm: { ...alarm, snooze: { ...alarm.snooze, enabled: false } } })).toBe(0);
  });
  it('currentMission / isFallbackOffered', () => {
    const settings = defaultSettings();
    const s = createRingSession(makeRing(alarm), [math, memory], 0);
    expect(currentMission(s, settings)).toBeNull();
    const solving: RingSession = { ...s, phase: 'solving', purpose: 'dismiss', missionIndex: 1, missionStartedAt: 0 };
    expect(currentMission(solving, settings)).toEqual(memory);
    expect(currentMission({ ...solving, purpose: 'snooze' }, settings)).toEqual(math);
    expect(currentMission({ ...solving, fallbackActive: true }, settings)).toEqual(settings.fallback.mission);
    expect(isFallbackOffered(solving, settings, 0)).toBe(false);
    expect(isFallbackOffered({ ...solving, failedAttempts: 3 }, settings, 0)).toBe(true);
    expect(isFallbackOffered(solving, settings, 5 * 60_000 - 1)).toBe(false);
    expect(isFallbackOffered(solving, settings, 5 * 60_000)).toBe(true);
    expect(isFallbackOffered({ ...solving, failedAttempts: 9, fallbackActive: true }, settings, 1e9)).toBe(false);
    expect(isFallbackOffered({ ...s, failedAttempts: 9 }, settings, 1e9)).toBe(false);
  });
});

describe('RingController', () => {
  it('starts alerting, persists, and reports UI readiness', async () => {
    const { rc, backend, persisted } = setup();
    expect(rc.getSession().phase).toBe('alerting');
    expect(persisted).toHaveLength(1);
    await rc.uiReady();
    expect(backend.missionUiReady).toHaveBeenCalledWith('s1');
  });

  it('full dismiss chain: solving each mission, then completing → dismissed with a mission token', async () => {
    const { rc, backend, finished, clock } = setup();
    const phases: string[] = [];
    rc.subscribe((s) => phases.push(`${s.phase}:${s.missionIndex}`));
    rc.startMission();
    expect(rc.getSession()).toMatchObject({ phase: 'solving', purpose: 'dismiss', missionIndex: 0, silenced: true, missionStartedAt: clock.t });
    expect(backend.setSilenced).toHaveBeenLastCalledWith('s1', true, 30_000);
    clock.advance(10_000);
    await rc.missionSucceeded();
    expect(rc.getSession()).toMatchObject({ phase: 'solving', missionIndex: 1, missionTimeMs: 10_000 });
    clock.advance(5_000);
    await rc.missionSucceeded();
    expect(backend.dismiss).toHaveBeenCalledWith({ sessionId: 's1', via: 'mission' });
    expect(rc.getSession()).toMatchObject({ phase: 'dismissed', missionIndex: 2, missionTimeMs: 15_000, silenced: false });
    expect(phases).toContain('completing:2');
    expect(finished).toHaveLength(1);
    expect(clock.pending).toBe(0);
    // never un-muted right before dismissal
    expect(backend.setSilenced.mock.calls.every((c) => c[1] === true)).toBe(true);
    // terminal: further input ignored, onFinished once
    rc.startMission();
    await rc.missionSucceeded();
    rc.applyRing(null);
    expect(finished).toHaveLength(1);
    expect(backend.dismiss).toHaveBeenCalledTimes(1);
  });

  it('empty plan dismisses immediately via no-mission', async () => {
    const { rc, backend, finished } = setup({ missions: [] });
    rc.startMission();
    await flush();
    expect(backend.dismiss).toHaveBeenCalledWith({ sessionId: 's1', via: 'no-mission' });
    expect(rc.getSession().phase).toBe('dismissed');
    expect(finished).toHaveLength(1);
  });

  it('a failed dismiss returns to alerting with progress kept; retry dismisses directly', async () => {
    const { rc, backend } = setup({ missions: [math] });
    backend.dismiss.mockRejectedValueOnce(new Error('native said no'));
    rc.startMission();
    await expect(rc.missionSucceeded()).rejects.toThrow('native said no');
    expect(rc.getSession()).toMatchObject({ phase: 'alerting', missionIndex: 1, silenced: false });
    expect(backend.setSilenced).toHaveBeenLastCalledWith('s1', false, 0);
    rc.startMission();
    await flush();
    expect(backend.dismiss).toHaveBeenCalledTimes(2);
    expect(rc.getSession().phase).toBe('dismissed');
  });

  it('a failed no-mission dismiss also returns to alerting', async () => {
    const { rc, backend } = setup({ missions: [] });
    backend.dismiss.mockRejectedValueOnce(new Error('x'));
    rc.startMission();
    await flush();
    expect(rc.getSession().phase).toBe('alerting');
  });

  it('snooze without mission', async () => {
    const { rc, backend, finished } = setup();
    await rc.requestSnooze();
    expect(backend.snooze).toHaveBeenCalledWith('s1');
    expect(rc.getSession().phase).toBe('snoozed');
    expect(finished).toHaveLength(1);
  });

  it('snooze rejected by the backend keeps alerting and rethrows', async () => {
    const { rc, backend, finished } = setup();
    backend.snooze.mockRejectedValueOnce(new Error('limit'));
    await expect(rc.requestSnooze()).rejects.toThrow('limit');
    expect(rc.getSession().phase).toBe('alerting');
    expect(finished).toHaveLength(0);
    expect(backend.setSilenced).not.toHaveBeenCalled();
  });

  it('snooze is a no-op when disabled, exhausted, on a wake-check re-ring, or while solving', async () => {
    for (const o of [
      { alarm: { snooze: { enabled: false, intervalMin: 5, maxCount: 3, requireMission: false } } },
      { alarm: {}, ring: { snoozeCount: 3 } },
      { alarm: {}, ring: { source: 'wake-check' as const } },
    ]) {
      const { rc, backend } = setup(o.alarm, { ring: o.ring });
      await rc.requestSnooze();
      expect(backend.snooze).not.toHaveBeenCalled();
      expect(rc.getSession().phase).toBe('alerting');
    }
    const { rc, backend } = setup();
    rc.startMission();
    await rc.requestSnooze();
    expect(backend.snooze).not.toHaveBeenCalled();
  });

  it('requireMission: solve plan[0] to snooze; cancel goes back to alerting and resumes sound', async () => {
    const snooze = { enabled: true, intervalMin: 5, maxCount: 3, requireMission: true };
    const { rc, backend, settings } = setup({ snooze, missions: [memory, math] });
    await rc.requestSnooze();
    expect(rc.getSession()).toMatchObject({ phase: 'solving', purpose: 'snooze' });
    expect(currentMission(rc.getSession(), settings)).toEqual(memory);
    expect(backend.snooze).not.toHaveBeenCalled();
    rc.cancelSnoozeMission();
    expect(rc.getSession()).toMatchObject({ phase: 'alerting', purpose: null, silenced: false });
    expect(backend.setSilenced).toHaveBeenLastCalledWith('s1', false, 0);
    await rc.requestSnooze();
    await rc.missionSucceeded();
    expect(backend.snooze).toHaveBeenCalledTimes(1);
    expect(rc.getSession().phase).toBe('snoozed');
    expect(backend.dismiss).not.toHaveBeenCalled();
  });

  it('requireMission with an empty plan snoozes directly', async () => {
    const { rc, backend } = setup({ missions: [], snooze: { enabled: true, intervalMin: 5, maxCount: 3, requireMission: true } });
    await rc.requestSnooze();
    expect(backend.snooze).toHaveBeenCalled();
  });

  it('a failed snooze after a snooze mission returns to alerting, unmutes, restores dismiss progress', async () => {
    const snooze = { enabled: true, intervalMin: 5, maxCount: 3, requireMission: true };
    const { rc, backend } = setup({ snooze });
    rc.startMission();
    rc.missionFailed();
    rc.missionFailed();
    rc.cancelSnoozeMission(); // "Back to alarm" from a dismiss mission keeps its failures
    expect(rc.getSession()).toMatchObject({ phase: 'alerting', failedAttempts: 2 });
    await rc.requestSnooze();
    expect(rc.getSession().failedAttempts).toBe(0);
    backend.snooze.mockRejectedValueOnce(new Error('no'));
    await expect(rc.missionSucceeded()).rejects.toThrow('no');
    expect(rc.getSession()).toMatchObject({ phase: 'alerting', failedAttempts: 2 });
    expect(backend.setSilenced).toHaveBeenLastCalledWith('s1', false, 0);
  });

  it('fallback by failures: offered after N failures, replaces only the current mission', async () => {
    const { rc, settings, backend, clock } = setup();
    rc.startMission();
    rc.acceptFallback(); // not offered yet
    expect(rc.getSession().fallbackActive).toBe(false);
    rc.missionFailed('wrong');
    rc.missionFailed('wrong');
    expect(isFallbackOffered(rc.getSession(), settings, clock.t)).toBe(false);
    rc.missionFailed('wrong');
    expect(rc.getSession()).toMatchObject({ failedAttempts: 3, totalFailedAttempts: 3 });
    expect(isFallbackOffered(rc.getSession(), settings, clock.t)).toBe(true);
    rc.acceptFallback();
    expect(rc.getSession()).toMatchObject({ fallbackActive: true, usedFallback: true, failedAttempts: 0, missionIndex: 0 });
    expect(currentMission(rc.getSession(), settings)).toEqual(settings.fallback.mission);
    expect(isFallbackOffered(rc.getSession(), settings, clock.t + 1e9)).toBe(false); // never a backup of the backup
    await rc.missionSucceeded();
    expect(rc.getSession()).toMatchObject({ missionIndex: 1, fallbackActive: false });
    expect(currentMission(rc.getSession(), settings)).toEqual(memory);
    await rc.missionSucceeded();
    expect(backend.dismiss).toHaveBeenCalledWith({ sessionId: 's1', via: 'fallback' });
  });

  it('fallback by time: unlocks after afterMinutes and emits without polling', () => {
    const { rc, settings, clock } = setup();
    const seen: boolean[] = [];
    rc.subscribe((s) => seen.push(isFallbackOffered(s, settings, clock.t)));
    rc.startMission();
    clock.advance(5 * 60_000 - 1);
    expect(isFallbackOffered(rc.getSession(), settings, clock.t)).toBe(false);
    clock.advance(1);
    expect(isFallbackOffered(rc.getSession(), settings, clock.t)).toBe(true);
    expect(seen.at(-1)).toBe(true);
  });

  it('missionFailed(MISSION_UNAVAILABLE) unlocks the fallback immediately', () => {
    const { rc, settings, clock } = setup();
    rc.startMission();
    rc.missionFailed(MISSION_UNAVAILABLE);
    expect(isFallbackOffered(rc.getSession(), settings, clock.t)).toBe(true);
  });

  it('capability missing at ring time → the fallback mission is in the plan', () => {
    const { rc, settings } = setup({ missions: [qr, shake] }, { caps: NONE });
    expect(rc.getSession().plan).toEqual([settings.fallback.mission, settings.fallback.mission]);
  });

  it('random plan is deterministic for a seeded rng', () => {
    const a = setup({ missions: [], randomMission: true }).rc.getSession().plan;
    const b = setup({ missions: [], randomMission: true }).rc.getSession().plan;
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
  });

  describe('silence while solving', () => {
    it('renews the lease on activity, throttled to SILENCE_RENEW_THROTTLE_MS', () => {
      const { rc, backend, clock, persisted } = setup();
      rc.startMission();
      expect(backend.setSilenced).toHaveBeenCalledTimes(1);
      const writes = persisted.length;
      clock.advance(1_000);
      rc.activity();
      clock.advance(SILENCE_RENEW_THROTTLE_MS - 1_001);
      rc.activity();
      expect(backend.setSilenced).toHaveBeenCalledTimes(1);
      expect(persisted.length).toBe(writes); // throttled activity is not written
      expect(rc.getSession().lastActivityAt).toBe(clock.t);
      clock.advance(1);
      rc.activity();
      expect(backend.setSilenced).toHaveBeenCalledTimes(2);
      expect(backend.setSilenced).toHaveBeenLastCalledWith('s1', true, 30_000);
    });

    it('idle timer flips silenced off after the lease; the next activity renews at once', () => {
      const { rc, backend, clock } = setup();
      rc.startMission();
      clock.advance(29_999);
      expect(rc.getSession().silenced).toBe(true);
      clock.advance(1);
      expect(rc.getSession().silenced).toBe(false);
      expect(backend.setSilenced).toHaveBeenCalledTimes(1); // native resumes on its own
      rc.activity();
      expect(rc.getSession().silenced).toBe(true);
      expect(backend.setSilenced).toHaveBeenCalledTimes(2);
    });

    it('activity resets the idle timer only when the lease is renewed', () => {
      const { rc, clock } = setup();
      rc.startMission();
      clock.advance(20_000);
      rc.activity(); // renew → idle at +30 s from here
      clock.advance(29_000);
      expect(rc.getSession().silenced).toBe(true);
      clock.advance(1_000);
      expect(rc.getSession().silenced).toBe(false);
    });

    it('lease follows settings.silenceWhileSolvingSec, clamped to MAX_SILENCE_LEASE_MS', () => {
      const s = { ...defaultSettings(), silenceWhileSolvingSec: 10 };
      const { rc, backend } = setup({}, { settings: s });
      rc.startMission();
      expect(backend.setSilenced).toHaveBeenLastCalledWith('s1', true, 10_000);
      const big = { ...defaultSettings(), silenceWhileSolvingSec: 600 };
      const r2 = setup({}, { settings: big });
      r2.rc.startMission();
      expect(r2.backend.setSilenced).toHaveBeenLastCalledWith('s1', true, MAX_SILENCE_LEASE_MS);
    });

    it('a native ring-state with silenced=false updates the local view', () => {
      const { rc, ring } = setup();
      rc.startMission();
      rc.applyRing({ ...ring, silenced: false, snoozeCount: 1 });
      expect(rc.getSession()).toMatchObject({ silenced: false, snoozeCount: 1, phase: 'solving' });
      rc.applyRing({ ...ring, silenced: false, snoozeCount: 1 }); // no change, no crash
    });

    it('activity and missionFailed are ignored outside solving', () => {
      const { rc, backend } = setup();
      rc.activity();
      rc.missionFailed();
      rc.acceptFallback();
      rc.cancelSnoozeMission();
      expect(backend.setSilenced).not.toHaveBeenCalled();
      expect(rc.getSession().totalFailedAttempts).toBe(0);
    });

    it('setSilenced rejections are swallowed', async () => {
      const { rc, backend } = setup();
      backend.setSilenced.mockRejectedValue(new Error('gone'));
      rc.startMission();
      await flush();
      expect(rc.getSession().phase).toBe('solving');
    });
  });

  describe('applyRing', () => {
    it.each([
      ['null (episode over)', null],
      ['snoozed elsewhere', { state: 'snoozed' as const }],
      ['another episode', { sessionId: 'other' }],
    ])('%s → ended, onFinished once, timers cleared', (_name, patch) => {
      const { rc, ring, finished, clock } = setup();
      rc.startMission();
      clock.advance(3_000);
      rc.applyRing(patch === null ? null : { ...ring, ...patch });
      expect(rc.getSession()).toMatchObject({ phase: 'ended', missionTimeMs: 3_000, silenced: false });
      expect(finished).toHaveLength(1);
      expect(clock.pending).toBe(0);
      rc.applyRing(null);
      expect(finished).toHaveLength(1);
    });

    it('an event for our own dismiss arriving before the promise resolves does not end the session', async () => {
      const { rc, backend, ring, finished } = setup({ missions: [math] });
      let resolve!: (v: { wakeCheckAt: null }) => void;
      backend.dismiss.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
      rc.startMission();
      const done = rc.missionSucceeded();
      rc.applyRing({ ...ring, state: 'wake-check-wait' });
      rc.applyRing(null);
      expect(rc.getSession().phase).toBe('completing');
      resolve({ wakeCheckAt: null });
      await done;
      expect(rc.getSession().phase).toBe('dismissed');
      expect(finished).toHaveLength(1);
    });

    it('if the in-flight call fails, the parked event is replayed', async () => {
      const { rc, backend, finished } = setup({ missions: [math] });
      let reject!: (e: Error) => void;
      backend.dismiss.mockImplementationOnce(() => new Promise((_r, j) => (reject = j)));
      rc.startMission();
      const done = rc.missionSucceeded();
      rc.applyRing(null);
      reject(new Error('superseded'));
      await expect(done).rejects.toThrow('superseded');
      expect(rc.getSession().phase).toBe('ended');
      expect(finished).toHaveLength(1);
    });
  });

  describe('restore after a crash (safety re-ring)', () => {
    it('keeps completed missions and the plan; snooze returns start fresh but keep the plan', () => {
      const first = setup({ missions: [], randomMission: true });
      const saved = { ...first.rc.getSession(), missionIndex: 1, phase: 'solving' as const, purpose: 'dismiss' as const };
      const safety = setup({ missions: [], randomMission: true }, { ring: { source: 'safety' }, restored: saved });
      expect(safety.rc.getSession()).toMatchObject({ missionIndex: 1, phase: 'alerting', plan: saved.plan });
      const snoozeReturn = setup({ missions: [math, memory] }, { ring: { source: 'snooze' }, restored: { ...saved, plan: [memory] } });
      expect(snoozeReturn.rc.getSession()).toMatchObject({ missionIndex: 0, plan: [memory] });
    });

    it('re-checks capabilities on a restored plan', () => {
      const saved = { ...setup().rc.getSession(), plan: [qr] };
      const r = setup({}, { caps: NONE, ring: { source: 'safety' }, restored: saved });
      expect(r.rc.getSession().plan).toEqual([r.settings.fallback.mission]);
    });

    it('a restored session with every mission done dismisses on startMission', async () => {
      const saved = { ...setup({ missions: [math] }).rc.getSession(), missionIndex: 1, usedFallback: true };
      const r = setup({ missions: [math] }, { ring: { source: 'safety' }, restored: saved });
      r.rc.startMission();
      await flush();
      expect(r.backend.dismiss).toHaveBeenCalledWith({ sessionId: 's1', via: 'fallback' });
    });
  });

  it('dispose clears timers and listeners; later calls are ignored', async () => {
    const { rc, clock, backend } = setup();
    const listener = vi.fn();
    rc.subscribe(listener);
    rc.startMission();
    const calls = listener.mock.calls.length;
    rc.dispose();
    expect(clock.pending).toBe(0);
    rc.activity();
    await rc.missionSucceeded();
    rc.applyRing(null);
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(backend.dismiss).not.toHaveBeenCalled();
  });

  it('unsubscribe stops notifications; a throwing persist never breaks the flow', () => {
    const { rc } = setup();
    const listener = vi.fn();
    const off = rc.subscribe(listener);
    off();
    rc.startMission();
    expect(listener).not.toHaveBeenCalled();
    const clock = new FakeClock(0);
    const rc2 = new RingController(makeRing(makeAlarm()), {
      backend: { snooze: vi.fn(), dismiss: vi.fn(), setSilenced: vi.fn(async () => {}), missionUiReady: vi.fn() },
      settings: defaultSettings(),
      now: clock.now,
      rng: createRng(1),
      capabilities: ALL,
      timers: clock,
      persist: () => {
        throw new Error('quota');
      },
    });
    rc2.startMission();
    expect(rc2.getSession().phase).toBe('solving');
  });

  it('uses real timers by default', () => {
    vi.useFakeTimers();
    try {
      const rc = new RingController(makeRing(makeAlarm()), {
        backend: { snooze: vi.fn(), dismiss: vi.fn(), setSilenced: vi.fn(async () => {}), missionUiReady: vi.fn() },
        settings: defaultSettings(),
        now: () => Date.now(),
        rng: createRng(1),
        capabilities: ALL,
      });
      rc.startMission();
      vi.advanceTimersByTime(30_000);
      expect(rc.getSession().silenced).toBe(false);
      rc.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
