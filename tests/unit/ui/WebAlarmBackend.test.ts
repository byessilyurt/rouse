import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEB_BACKEND_KEY, WebAlarmBackend } from '../../../src/platform/web/WebAlarmBackend';
import type { BackendEvent, DismissToken } from '../../../src/platform/AlarmBackend';
import { createAlarm, defaultSettings } from '../../../src/core/defaults';
import { nextOccurrence } from '../../../src/core/schedule';
import type { Alarm } from '../../../src/core/types';

class MemStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const T0 = new Date(2026, 9, 15, 6, 0, 0).getTime(); // local 06:00

function alarm(patch: Partial<Alarm> = {}): Alarm {
  return { ...createAlarm({ id: patch.id ?? 'a1', now: T0, hour: 6, minute: 30 }), missions: [], ...patch };
}

const token = (sessionId: string, via: 'mission' | 'no-mission' = 'mission') => ({ sessionId, via }) as unknown as DismissToken;

describe('WebAlarmBackend', () => {
  let storage: MemStorage;
  let events: BackendEvent[];
  let backend: WebAlarmBackend;

  const make = async (opts: { testHooks?: boolean } = {}) => {
    const b = new WebAlarmBackend({ storage, now: () => Date.now(), testHooks: opts.testHooks });
    b.subscribe((e) => events.push(e));
    await b.init();
    return b;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    storage = new MemStorage();
    events = [];
    backend = await make();
  });
  afterEach(() => {
    backend.dispose();
    vi.useRealTimers();
  });

  it('sync schedules the next fire with core/schedule and reports per-alarm times', async () => {
    const a = alarm();
    const res = await backend.sync([a, alarm({ id: 'off', enabled: false })], defaultSettings());
    expect(res.next?.fireAt).toBe(nextOccurrence(a, T0));
    expect(res.alarms).toEqual([
      { alarmId: 'a1', nextFireAt: nextOccurrence(a, T0) },
      { alarmId: 'off', nextFireAt: null },
    ]);
    expect(await backend.getNextFire()).toEqual(res.next);
  });

  it('rings at the scheduled instant via the single re-armed timer, and consumes a one-off', async () => {
    await backend.sync([alarm({ days: [] })], defaultSettings());
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(await backend.getActiveRing()).toBeNull();
    await vi.advanceTimersByTimeAsync(61_000);
    const ring = await backend.getActiveRing();
    expect(ring).toMatchObject({ alarmId: 'a1', state: 'ringing', source: 'scheduled', isTest: false });
    expect(events.some((e) => e.type === 'ring')).toBe(true);
    const log = await backend.getLog(0);
    expect(log.map((e) => e.type)).toEqual(['ring-started', 'one-off-consumed']);
    expect(log[0]!.seq).toBe(1);
    expect((await backend.getNextFire())).toBeNull();
  });

  it('logs "missed" instead of ringing when the fire time is older than the grace period', async () => {
    await backend.sync([alarm()], defaultSettings());
    vi.setSystemTime(T0 + 30 * 60_000 + 31 * 60_000); // 31 min late, timers frozen meanwhile
    backend.check();
    expect(await backend.getActiveRing()).toBeNull();
    expect((await backend.getLog(0)).map((e) => e.type)).toEqual(['missed']);
  });

  it('enforces the snooze rules and rings again when the snooze ends', async () => {
    await backend.sync([alarm({ snooze: { enabled: true, intervalMin: 5, maxCount: 1, requireMission: false } })], defaultSettings());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const ring = (await backend.getActiveRing())!;
    const { snoozeUntil } = await backend.snooze(ring.sessionId);
    expect(snoozeUntil).toBe(Date.now() + 5 * 60_000);
    expect((await backend.getActiveRing())?.state).toBe('snoozed');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const again = (await backend.getActiveRing())!;
    expect(again).toMatchObject({ state: 'ringing', source: 'snooze', snoozeCount: 1, sessionId: ring.sessionId });
    await expect(backend.snooze(ring.sessionId)).rejects.toMatchObject({ code: 'SNOOZE_NOT_ALLOWED' });
    await expect(backend.snooze('other')).rejects.toMatchObject({ code: 'SESSION_MISMATCH' });
  });

  it('a silence lease mutes, expires (≤ 60 s) and resumes loud', async () => {
    await backend.sync([alarm()], defaultSettings());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const ring = (await backend.getActiveRing())!;
    await backend.setSilenced(ring.sessionId, true, 120_000);
    expect((await backend.getActiveRing())?.silenced).toBe(true);
    await vi.advanceTimersByTimeAsync(59_000);
    expect((await backend.getActiveRing())?.silenced).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await backend.getActiveRing())?.silenced).toBe(false);
    expect(events.filter((e) => e.type === 'ring-state').length).toBeGreaterThanOrEqual(2);
  });

  it('dismiss → wake-up check → deadline re-rings (no snooze) → confirm ends the episode', async () => {
    await backend.sync([alarm({ wakeUpCheck: { enabled: true, delayMin: 5, windowMin: 2 } })], defaultSettings());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const ring = (await backend.getActiveRing())!;
    const { wakeCheckAt } = await backend.dismiss(token(ring.sessionId));
    expect(wakeCheckAt).toBe(Date.now() + 5 * 60_000);
    expect((await backend.getActiveRing())?.state).toBe('wake-check-wait');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect((await backend.getActiveRing())?.state).toBe('wake-check-prompt');
    await vi.advanceTimersByTimeAsync(1); // events are delivered asynchronously, like the plugin bridge
    expect(events.some((e) => e.type === 'wake-check')).toBe(true);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    const rerung = (await backend.getActiveRing())!;
    expect(rerung).toMatchObject({ state: 'ringing', source: 'wake-check', wakeCheckReRings: 1 });
    await expect(backend.snooze(rerung.sessionId)).rejects.toMatchObject({ code: 'SNOOZE_NOT_ALLOWED' });
    await backend.dismiss(token(rerung.sessionId));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await backend.confirmAwake(rerung.sessionId);
    expect(await backend.getActiveRing()).toBeNull();
    const types = (await backend.getLog(0)).map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(['dismissed', 'wake-check-shown', 'wake-check-failed', 'wake-check-confirmed', 'episode-ended']),
    );
  });

  it('a reload mid-ring resumes ringing as a safety re-ring (state persisted in localStorage)', async () => {
    await backend.sync([alarm()], defaultSettings());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const ring = (await backend.getActiveRing())!;
    await backend.setSilenced(ring.sessionId, true, 30_000);
    expect(storage.getItem(WEB_BACKEND_KEY)).toContain(ring.sessionId);
    backend.dispose();
    events = [];
    backend = await make();
    const resumed = (await backend.getActiveRing())!;
    expect(resumed).toMatchObject({ sessionId: ring.sessionId, state: 'ringing', source: 'safety', silenced: false });
  });

  it('test rings write no log events and never supersede a real ring', async () => {
    await backend.testAlarm(alarm({ id: 'test' }), 1);
    await vi.advanceTimersByTimeAsync(1000);
    const t = (await backend.getActiveRing())!;
    expect(t).toMatchObject({ isTest: true, source: 'test' });
    await backend.dismiss(token(t.sessionId, 'no-mission'));
    expect(await backend.getActiveRing()).toBeNull();
    expect(await backend.getLog(0)).toEqual([]);

    await backend.sync([alarm()], defaultSettings());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const real = (await backend.getActiveRing())!;
    await backend.testAlarm(alarm({ id: 'test' }), 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await backend.getActiveRing())?.sessionId).toBe(real.sessionId);
  });

  it('getPendingTest reports a scheduled test until it fires; cancelTest drops it before it rings', async () => {
    expect(await backend.getPendingTest()).toBeNull();
    const { fireAt } = await backend.testAlarm(alarm({ id: 'test' }), 60);
    expect(await backend.getPendingTest()).toEqual({ fireAt });
    expect(storage.getItem(WEB_BACKEND_KEY)).toContain('"test"');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(await backend.getPendingTest()).toEqual({ fireAt }); // still pending halfway
    await backend.cancelTest();
    expect(await backend.getPendingTest()).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await backend.getActiveRing()).toBeNull(); // never rang
    expect(await backend.getLog(0)).toEqual([]);

    // The cancelled test is gone from persisted state too.
    backend.dispose();
    backend = await make();
    expect(await backend.getPendingTest()).toBeNull();
  });

  it('a fired test is no longer pending', async () => {
    await backend.testAlarm(alarm({ id: 'test' }), 5);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await backend.getPendingTest()).toBeNull();
    expect(await backend.getActiveRing()).toMatchObject({ isTest: true, state: 'ringing' });
  });

  it('cancelTest ends a ringing test cleanly: no stats, no log, ring-state(null), audio stopped', async () => {
    const hooked = await make({ testHooks: true });
    try {
      await hooked.testAlarm(alarm({ id: 'test' }), 1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(window.__rouseTest!.inspect()).toMatchObject({ ring: { isTest: true }, audio: 'playing' });
      events = [];
      await hooked.cancelTest();
      await vi.advanceTimersByTimeAsync(10);
      expect(await hooked.getActiveRing()).toBeNull();
      expect(window.__rouseTest!.inspect().audio).toBe('stopped');
      expect(await hooked.getLog(0)).toEqual([]);
      expect(events).toContainEqual({ type: 'ring-state', ring: null });
    } finally {
      hooked.dispose();
    }
  });

  it('cancelTest ends a snoozed test ring', async () => {
    await backend.testAlarm(alarm({ id: 'test', snooze: { enabled: true, intervalMin: 5, maxCount: 3, requireMission: false } }), 1);
    await vi.advanceTimersByTimeAsync(1_000);
    const t = (await backend.getActiveRing())!;
    await backend.snooze(t.sessionId);
    expect(await backend.getActiveRing()).toMatchObject({ state: 'snoozed', isTest: true });
    await backend.cancelTest();
    expect(await backend.getActiveRing()).toBeNull();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await backend.getActiveRing()).toBeNull(); // the snooze timer is gone with the episode
  });

  it('cancelTest never touches a real ring and resolves when nothing is pending', async () => {
    await backend.cancelTest(); // nothing to cancel
    await backend.sync([alarm()], defaultSettings());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const real = (await backend.getActiveRing())!;
    expect(real.isTest).toBe(false);
    await backend.testAlarm(alarm({ id: 'test' }), 30);
    await backend.cancelTest();
    expect(await backend.getPendingTest()).toBeNull();
    expect(await backend.getActiveRing()).toMatchObject({ sessionId: real.sessionId, state: 'ringing' });
  });

  it('getDiagnostics summarises state without alarm labels', async () => {
    await backend.sync([alarm({ label: 'Secret dentist appointment' })], defaultSettings());
    const { fireAt } = await backend.testAlarm(alarm({ id: 'test', label: 'Private test label' }), 60);
    await vi.advanceTimersByTimeAsync(30 * 60_000); // the 06:30 alarm rings
    const text = await backend.getDiagnostics();
    expect(text).toMatch(/^Rouse diagnostics · web · /);
    expect(text).toContain('[health]');
    expect(text).toContain('lockedDevice: unsupported (critical)');
    expect(text).toContain('[scheduled]');
    expect(text).toContain('episode: ringing · source scheduled · test false');
    expect(text).toContain('alarms mirrored: 1');
    expect(text).toMatch(/#\d+ ring-started/);
    expect(text).not.toContain('Secret dentist appointment');
    expect(text).not.toContain('Private test label');
    expect(fireAt).toBeLessThan(Date.now()); // the test did fire, so no pending line
    expect(text).toContain('pending test: none');

    const t2 = await backend.testAlarm(alarm({ id: 'test2' }), 120);
    expect(await backend.getDiagnostics()).toContain(`pending test: ${new Date(t2.fireAt).toISOString()}`);
  });

  it('an alarm firing during a snooze supersedes it; one firing while ringing is merged', async () => {
    const a = alarm({ id: 'a', snooze: { enabled: true, intervalMin: 15, maxCount: 3, requireMission: false } });
    const b = alarm({ id: 'b', minute: 33 });
    const c = alarm({ id: 'c', minute: 45 });
    await backend.sync([a, b, c], defaultSettings());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const first = (await backend.getActiveRing())!;
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect((await backend.getActiveRing())?.sessionId).toBe(first.sessionId);
    expect((await backend.getLog(0)).some((e) => e.type === 'merged' && e.alarmId === 'b')).toBe(true);
    await backend.snooze(first.sessionId);
    await vi.advanceTimersByTimeAsync(12 * 60_000); // c fires at 06:45, during the snooze (until 06:48) → supersedes
    const now = (await backend.getActiveRing())!;
    expect(now).toMatchObject({ alarmId: 'c', state: 'ringing', snoozeCount: 0 });
    expect(now.sessionId).not.toBe(first.sessionId);
    expect((await backend.getLog(0)).some((e) => e.type === 'superseded' && e.sessionId === first.sessionId)).toBe(true);
  });

  it('getLog/ackLog: events after afterSeq, acked events are not returned again', async () => {
    await backend.sync([alarm()], defaultSettings());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const log = await backend.getLog(0);
    expect(log).toHaveLength(1);
    await backend.ackLog(log[0]!.seq);
    expect(await backend.getLog(0)).toEqual([]);
  });

  it('installs window.__rouseTest hooks only when asked', async () => {
    expect(window.__rouseTest).toBeUndefined();
    const hooked = await make({ testHooks: true });
    try {
      await hooked.sync([alarm({ id: 'h' })], defaultSettings());
      const sessionId = await window.__rouseTest!.ringNow('h');
      const snap = window.__rouseTest!.inspect();
      expect(snap.ring?.sessionId).toBe(sessionId);
      expect(snap.audio).toBe('playing');
      expect(snap.timers.map((t) => t.kind)).toContain('alarm');
      const got: string[] = [];
      window.addEventListener('rouse:test-scan', (e) => got.push((e as CustomEvent<string>).detail));
      window.__rouseTest!.injectScan('CODE-1');
      expect(got).toEqual(['CODE-1']);
      await hooked.snooze(sessionId);
      await window.__rouseTest!.fireNextTimer();
      expect(window.__rouseTest!.inspect().ring?.state).toBe('ringing');
    } finally {
      hooked.dispose();
    }
    expect(window.__rouseTest).toBeUndefined();
  });

  it('health on the web reports that it cannot wake a locked phone', async () => {
    const h = await backend.getHealth();
    expect(h.platform).toBe('web');
    expect(h.checks.find((c) => c.id === 'lockedDevice')).toMatchObject({ state: 'unsupported', severity: 'critical' });
    expect(backend.capabilities.canWakeLockedDevice).toBe(false);
    expect((await backend.listSounds()).map((s) => s.ref)).toContainEqual({ kind: 'bundled', id: 'classic' });
  });
});
