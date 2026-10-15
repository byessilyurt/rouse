import { describe, expect, it } from 'vitest';
import { RouseService } from '../../../src/core/service';
import { Repository } from '../../../src/core/storage';
import { MAX_ALARMS, RING_PROGRESS_KEY_PREFIX, defaultMissionConfig, defaultSettings } from '../../../src/core/defaults';
import type { Alarm, RingSession } from '../../../src/core/types';
import type { AlarmLogEvent } from '../../../src/platform/AlarmBackend';
import { ianaZone } from '../../../src/core/zone';
import { FakeBackend, MemoryStorage, iso, makeAlarm } from './testUtils';

const utc = ianaZone('UTC');

function setup(start = iso('2026-10-15T06:00:00Z')) {
  const clock = { t: start };
  const now = () => clock.t;
  const storage = new MemoryStorage();
  const repo = new Repository(storage, now);
  const backend = new FakeBackend(now, utc);
  let id = 0;
  const service = new RouseService({ repo, backend, now, newId: () => `id-${++id}`, appVersion: '9.9.9', zone: utc });
  return { service, repo, backend, clock, storage };
}

let seq = 0;
const ev = <T extends AlarmLogEvent['type']>(type: T, fields: Partial<AlarmLogEvent> & Record<string, unknown> = {}): AlarmLogEvent =>
  ({ seq: ++seq, at: iso('2026-10-15T07:00:00Z'), sessionId: 'S', alarmId: 'a1', type, ...fields }) as AlarmLogEvent;

describe('RouseService', () => {
  it('init: loads storage, inits backend, applies the log, syncs, subscribes to log events; idempotent', async () => {
    const { service, backend } = setup();
    await service.init();
    await service.init();
    expect(backend.init).toHaveBeenCalledTimes(1);
    expect(backend.sync).toHaveBeenCalledTimes(1);
    expect(backend.getLog).toHaveBeenCalledWith(0);
    expect(backend.listeners.size).toBe(1);
    expect(service.getLastSync()).toEqual({ next: null, alarms: [], bedtimeReminderAt: null });
  });

  it('init can be retried after a failure', async () => {
    const { service, backend } = setup();
    backend.sync.mockRejectedValueOnce(new Error('bridge down'));
    await expect(service.init()).rejects.toThrow('bridge down');
    await service.init();
    expect(backend.sync).toHaveBeenCalledTimes(2);
  });

  it('newAlarmDraft uses settings.alarmDefaults and is not persisted', async () => {
    const { service } = setup();
    await service.updateSettings({ alarmDefaults: { ...defaultSettings().alarmDefaults, volume: 55 } });
    const draft = service.newAlarmDraft();
    expect(draft).toMatchObject({ id: 'id-1', volume: 55, enabled: true });
    expect(service.getAlarms()).toEqual([]);
  });

  it('saveAlarm: validates, persists, syncs ALL alarms, notifies', async () => {
    const { service, backend } = setup();
    let notified = 0;
    const off = service.subscribe(() => notified++);
    const bad = await service.saveAlarm({ ...service.newAlarmDraft(), missions: [{ type: 'qr', expectedCode: '', label: '' }] });
    expect(bad).toEqual({ ok: false, issues: [{ path: 'missions.0.expectedCode', message: expect.any(String) }] });
    expect(backend.sync).not.toHaveBeenCalled();

    const a = await service.saveAlarm({ ...service.newAlarmDraft(), hour: 7, label: '  ' });
    expect(a.ok).toBe(true);
    await service.saveAlarm({ ...service.newAlarmDraft(), hour: 6, enabled: false });
    expect(backend.syncCalls.at(-1)?.alarms).toHaveLength(2);
    expect(notified).toBeGreaterThan(0);
    off();
    expect(service.getAlarms().map((x) => x.hour)).toEqual([6, 7]);
  });

  it('saveAlarm normalises, keeps createdAt, clears skipUntil only when the time changes', async () => {
    const { service, clock } = setup();
    const saved = await service.saveAlarm({ ...service.newAlarmDraft(), days: [3, 1, 1], hour: 7, minute: 0 });
    if (!saved.ok) throw new Error('save failed');
    expect(saved.alarm.days).toEqual([1, 3]);
    await service.skipNext(saved.alarm.id);
    const skipped = service.getAlarm(saved.alarm.id) as Alarm;
    expect(skipped.skipUntil).not.toBeNull();
    clock.t += 1000;
    await service.saveAlarm({ ...skipped, label: 'Renamed', createdAt: 0 });
    expect(service.getAlarm(saved.alarm.id)).toMatchObject({ label: 'Renamed', skipUntil: skipped.skipUntil, createdAt: saved.alarm.createdAt });
    await service.saveAlarm({ ...skipped, minute: 5 });
    expect(service.getAlarm(saved.alarm.id)?.skipUntil).toBeNull();
  });

  it('saveAlarm clears a stale (past) skip marker and enforces MAX_ALARMS', async () => {
    const { service, repo } = setup();
    const r = await service.saveAlarm({ ...service.newAlarmDraft(), skipUntil: 5 });
    expect(r.ok && r.alarm.skipUntil).toBeNull();
    for (let i = repo.getAlarms().length; i < MAX_ALARMS; i++) repo.upsertAlarm(makeAlarm({ id: `x${i}` }));
    const full = await service.saveAlarm(service.newAlarmDraft());
    expect(full.ok).toBe(false);
  });

  it('delete, enable/disable, skip/unskip each persist and sync', async () => {
    const { service, backend } = setup();
    const r = await service.saveAlarm({ ...service.newAlarmDraft(), days: [], hour: 7, minute: 0 });
    if (!r.ok) throw new Error();
    const id = r.alarm.id;
    const before = backend.sync.mock.calls.length;
    await service.setEnabled(id, false);
    await service.setEnabled(id, false); // no-op
    expect(service.getAlarm(id)?.enabled).toBe(false);
    await service.setEnabled(id, true);
    await service.skipNext(id);
    expect(service.getAlarm(id)?.skipUntil).toBe(iso('2026-10-15T07:00:00Z'));
    expect(service.nextFire()?.fireAt).toBe(iso('2026-10-16T07:00:00Z'));
    await service.unskip(id);
    await service.unskip(id); // no-op
    expect(service.nextFire()?.fireAt).toBe(iso('2026-10-15T07:00:00Z'));
    await service.deleteAlarm(id);
    await service.deleteAlarm(id); // no-op
    await service.setEnabled('missing', true);
    expect(service.getAlarms()).toEqual([]);
    expect(backend.sync.mock.calls.length - before).toBe(5);
  });

  it('quickNap creates a one-off "Nap" alarm that deletes itself', async () => {
    const { service, clock } = setup(iso('2026-10-15T13:00:20Z'));
    const nap = await service.quickNap(20);
    expect(nap).toMatchObject({ label: 'Nap', days: [], deleteAfterRing: true, hour: 13, minute: 21, enabled: true });
    expect(service.nextFire()?.fireAt).toBe(iso('2026-10-15T13:21:00Z'));
    clock.t = iso('2026-10-15T13:00:00Z');
    const def = await service.quickNap();
    expect(def).toMatchObject({ hour: 13, minute: 20 }); // settings.napMinutes = 20
  });

  it('updateSettings sanitises and syncs', async () => {
    const { service, backend } = setup();
    await service.updateSettings({ napMinutes: 9999, theme: 'dark' });
    expect(service.getSettings()).toMatchObject({ napMinutes: 120, theme: 'dark' });
    expect(backend.syncCalls.at(-1)?.settings.theme).toBe('dark');
  });

  it('records TS/backend next-fire mismatches (D-011)', async () => {
    const { service, backend } = setup();
    const r = await service.saveAlarm({ ...service.newAlarmDraft(), days: [], hour: 7, minute: 0 });
    if (!r.ok) throw new Error();
    expect(service.getSchedulerMismatches()).toEqual([]);
    backend.nextFireOverride.set(r.alarm.id, iso('2026-10-15T08:00:00Z'));
    await service.setEnabled(r.alarm.id, false);
    await service.setEnabled(r.alarm.id, true);
    expect(service.getSchedulerMismatches()).toEqual([{ alarmId: r.alarm.id, ts: iso('2026-10-15T07:00:00Z'), backend: iso('2026-10-15T08:00:00Z') }]);
    backend.nextFireOverride.set(r.alarm.id, iso('2026-10-15T05:00:00Z')); // already in the past: not a disagreement
    await service.setEnabled(r.alarm.id, false);
    await service.setEnabled(r.alarm.id, true);
    expect(service.getSchedulerMismatches()).toEqual([]);
  });

  it('only the latest of concurrent syncs is kept', async () => {
    const { service, backend } = setup();
    let release!: () => void;
    backend.sync.mockImplementationOnce(
      (alarms) => new Promise((res) => (release = () => res({ next: null, alarms: alarms.map((a) => ({ alarmId: a.id, nextFireAt: 1 })), bedtimeReminderAt: 111 }))),
    );
    const first = service.updateSettings({ theme: 'dark' });
    await service.updateSettings({ theme: 'light' });
    release();
    await first;
    expect(service.getLastSync()?.bedtimeReminderAt).toBeNull();
  });

  describe('applyLog', () => {
    it('applies events idempotently by seq, acks, and stores lastAppliedLogSeq', async () => {
      const { service, backend, repo } = setup();
      repo.upsertAlarm(makeAlarm({ id: 'a1', label: 'Work', updatedAt: 0 }));
      seq = 0;
      backend.log = [
        ev('ring-started', { source: 'scheduled', scheduledFor: iso('2026-10-15T07:00:00Z') }),
        ev('snoozed', { snoozeCount: 1, snoozeUntil: 0 }),
        ev('ring-started', { source: 'snooze', scheduledFor: null, at: iso('2026-10-15T07:05:00Z') }),
        ev('dismissed', { via: 'mission', wakeCheckAt: null, at: iso('2026-10-15T07:08:00Z') }),
        ev('episode-ended', { reason: 'dismissed' }),
      ];
      await service.applyLog();
      await service.applyLog();
      expect(repo.getMeta().lastAppliedLogSeq).toBe(5);
      expect(backend.acked).toBe(5);
      expect(service.getWakeRecords()).toEqual([
        expect.objectContaining({
          id: 'S',
          alarmId: 'a1',
          label: 'Work',
          scheduledFor: iso('2026-10-15T07:00:00Z'),
          firstRangAt: iso('2026-10-15T07:00:00Z'),
          dismissedAt: iso('2026-10-15T07:08:00Z'),
          outcome: 'dismissed',
          snoozeCount: 1,
          wakeCheck: 'off',
        }),
      ]);
      expect(backend.ackLog).toHaveBeenCalledTimes(1);
      // A backend that resends old events (e.g. before ack) changes nothing.
      backend.getLog.mockResolvedValueOnce(backend.log);
      await service.applyLog();
      expect(service.getWakeRecords()).toHaveLength(1);
      expect(backend.ackLog).toHaveBeenCalledTimes(1);
    });

    it('one-off-consumed disables, or deletes a nap, and syncs', async () => {
      const { service, backend, repo } = setup();
      repo.upsertAlarm(makeAlarm({ id: 'a1', days: [] }));
      repo.upsertAlarm(makeAlarm({ id: 'nap', days: [], deleteAfterRing: true }));
      const syncs = backend.sync.mock.calls.length;
      backend.log = [ev('one-off-consumed', { alarmId: 'a1', at: iso('2026-10-15T08:00:00Z') }), ev('one-off-consumed', { alarmId: 'nap', at: iso('2026-10-15T08:00:00Z') })];
      await service.applyLog();
      expect(service.getAlarm('a1')?.enabled).toBe(false);
      expect(service.getAlarm('nap')).toBeUndefined();
      expect(backend.sync.mock.calls.length).toBe(syncs + 1);
    });

    it('one-off-consumed is ignored when the alarm was edited after it fired, or is unknown/disabled', async () => {
      const { service, backend, repo } = setup();
      repo.upsertAlarm(makeAlarm({ id: 'a1', days: [] })); // updatedAt = 06:00
      repo.upsertAlarm(makeAlarm({ id: 'off', days: [], enabled: false }));
      backend.log = [
        ev('one-off-consumed', { alarmId: 'a1', at: iso('2026-10-15T05:00:00Z') }),
        ev('one-off-consumed', { alarmId: 'ghost' }),
        ev('one-off-consumed', { alarmId: 'off', at: iso('2026-10-15T08:00:00Z') }),
      ];
      const syncs = backend.sync.mock.calls.length;
      await service.applyLog();
      expect(service.getAlarm('a1')?.enabled).toBe(true);
      expect(backend.sync.mock.calls.length).toBe(syncs);
    });

    it('wake-up check: shown → failed (re-ring) → dismissed again → confirmed', async () => {
      const { service, backend } = setup();
      backend.log = [
        ev('ring-started', { source: 'scheduled', scheduledFor: 1 }),
        ev('dismissed', { via: 'mission', wakeCheckAt: 5 }),
        ev('wake-check-shown', { deadlineAt: 9 }),
        ev('wake-check-failed', { reRingCount: 1 }),
        ev('ring-started', { source: 'wake-check', scheduledFor: 1 }),
      ];
      await service.applyLog();
      expect(service.getWakeRecords()[0]).toMatchObject({ wakeCheck: 'failed', wakeCheckReRings: 1, outcome: 'dismissed' });
      backend.log.push(ev('dismissed', { via: 'fallback', wakeCheckAt: 7 }), ev('wake-check-confirmed'), ev('episode-ended', { reason: 'wake-check-confirmed' }));
      await service.applyLog();
      expect(service.getWakeRecords()[0]).toMatchObject({ wakeCheck: 'confirmed', usedFallback: true });
    });

    it('max re-rings: final dismissal without a check marks the wake check failed', async () => {
      const { service, backend } = setup();
      backend.log = [
        ev('ring-started', { source: 'scheduled', scheduledFor: 1 }),
        ev('wake-check-failed', { reRingCount: 2 }),
        ev('dismissed', { via: 'native-fallback', wakeCheckAt: null }),
        ev('episode-ended', { reason: 'dismissed' }),
      ];
      await service.applyLog();
      expect(service.getWakeRecords()[0]).toMatchObject({ wakeCheck: 'failed', usedNativeFallback: true, outcome: 'dismissed' });
    });

    it('missed, superseded and merged events', async () => {
      const { service, backend } = setup();
      backend.log = [
        ev('missed', { sessionId: 'M', scheduledFor: 42 }),
        ev('ring-started', { sessionId: 'A', source: 'scheduled', scheduledFor: 1 }),
        ev('superseded', { sessionId: 'A', bySessionId: 'B' }),
        ev('episode-ended', { sessionId: 'A', reason: 'superseded' }),
        ev('ring-started', { sessionId: 'B', source: 'scheduled', scheduledFor: 2 }),
        ev('merged', { sessionId: 'B', ringingAlarmId: 'a1', alarmId: 'a2' }),
        ev('dismissed', { sessionId: 'C', via: 'mission', wakeCheckAt: 3 }),
        ev('superseded', { sessionId: 'C', bySessionId: 'B' }),
        ev('episode-ended', { sessionId: 'C', reason: 'superseded' }),
      ];
      await service.applyLog();
      const byId = Object.fromEntries(service.getWakeRecords().map((r) => [r.id, r]));
      expect(byId.M).toMatchObject({ outcome: 'missed', scheduledFor: 42, firstRangAt: null });
      expect(byId.A).toMatchObject({ outcome: 'superseded' });
      expect(byId.B).toMatchObject({ outcome: 'abandoned' }); // still in progress
      expect(byId.C).toMatchObject({ outcome: 'dismissed', wakeCheck: 'off' });
      expect(Object.keys(byId)).toHaveLength(4);
    });

    it('episode-ended clears persisted ring progress', async () => {
      const { service, backend, repo, storage } = setup();
      repo.saveRingProgress({ sessionId: 'S', alarm: makeAlarm(), plan: [], missionIndex: 0 } as unknown as RingSession);
      backend.log = [ev('episode-ended', { reason: 'dismissed' })];
      await service.applyLog();
      expect(storage.getItem(`${RING_PROGRESS_KEY_PREFIX}S`)).toBeNull();
    });

    it("a backend 'log' event triggers applyLog after init; concurrent calls do not double-apply", async () => {
      const { service, backend } = setup();
      await service.init();
      backend.log = [ev('ring-started', { source: 'scheduled', scheduledFor: 1 }), ev('snoozed', { snoozeCount: 1, snoozeUntil: 2 })];
      backend.emit({ type: 'log' });
      await Promise.all([service.applyLog(), service.applyLog()]);
      expect(service.getWakeRecords()).toHaveLength(1);
      expect(service.getWakeRecords()[0]?.snoozeCount).toBe(1);
      backend.emit({ type: 'health-changed' });
    });

    it('a failing getLog rejects but does not block later calls', async () => {
      const { service, backend } = setup();
      backend.getLog.mockRejectedValueOnce(new Error('x'));
      await expect(service.applyLog()).rejects.toThrow('x');
      backend.log = [ev('missed', { scheduledFor: 1 })];
      await service.applyLog();
      expect(service.getWakeRecords()).toHaveLength(1);
    });
  });

  describe('recordRingOutcome', () => {
    function session(over: Partial<RingSession> = {}): RingSession {
      return {
        sessionId: 'S',
        alarmId: 'a1',
        alarm: makeAlarm({ id: 'a1', label: 'Gym' }),
        source: 'scheduled',
        episodeStartedAt: 100,
        ringStartedAt: 100,
        snoozeCount: 0,
        phase: 'dismissed',
        purpose: null,
        plan: [defaultMissionConfig('math'), defaultMissionConfig('typing')],
        missionIndex: 2,
        failedAttempts: 0,
        totalFailedAttempts: 2,
        fallbackActive: false,
        usedFallback: true,
        missionStartedAt: null,
        missionTimeMs: 40_000,
        silenced: false,
        lastActivityAt: null,
        ...over,
      };
    }

    it('merges JS metrics into the record, once per finished controller, summing across snoozes', async () => {
      const { service, backend } = setup();
      backend.log = [ev('ring-started', { source: 'scheduled', scheduledFor: 1 })];
      await service.applyLog();
      service.recordRingOutcome(session({ phase: 'snoozed', missionTimeMs: 5_000, totalFailedAttempts: 1, usedFallback: false }), false);
      service.recordRingOutcome(session({ ringStartedAt: 400 }), false);
      service.recordRingOutcome(session({ ringStartedAt: 400 }), false); // duplicate ignored
      expect(service.getWakeRecords()[0]).toMatchObject({
        label: 'Gym',
        missionTimeMs: 45_000,
        failedAttempts: 3,
        usedFallback: true,
        missionsCompleted: 2,
        snoozeCount: 1,
        outcome: 'dismissed',
        scheduledFor: 1,
      });
    });

    it('creates a record when the log has not arrived yet; ignores test rings', () => {
      const { service } = setup();
      service.recordRingOutcome(session({ sessionId: 'T' }), true);
      service.recordRingOutcome(session({ sessionId: 'T2', source: 'test' }), false);
      expect(service.getWakeRecords()).toEqual([]);
      service.recordRingOutcome(session(), false);
      expect(service.getWakeRecords()[0]).toMatchObject({ id: 'S', firstRangAt: 100, outcome: 'dismissed', dismissedAt: iso('2026-10-15T06:00:00Z') });
    });
  });

  it('stats, export and import', async () => {
    const { service, backend } = setup();
    await service.saveAlarm({ ...service.newAlarmDraft(), label: 'Exported' });
    expect(service.getStats().episodes).toBe(0);
    const text = service.exportBackup();
    expect(text).toContain('\n  "format": "rouse-backup"');
    expect(JSON.parse(text).appVersion).toBe('9.9.9');

    const other = setup();
    other.backend.customSounds = ['snd'];
    const r = await other.service.importBackup(text, 'merge');
    expect(r).toMatchObject({ ok: true, alarmsImported: 1 });
    expect(other.service.getAlarms()[0]?.label).toBe('Exported');
    expect(other.backend.sync).toHaveBeenCalled();

    const bad = await other.service.importBackup('nope', 'replace');
    expect(bad.ok).toBe(false);
    backend.listSounds.mockRejectedValueOnce(new Error('no sounds'));
    const again = await service.importBackup(text, 'replace');
    expect(again.ok).toBe(true);
  });
});
