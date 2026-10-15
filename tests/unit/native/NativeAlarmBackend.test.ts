import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveRing, BackendEvent, DismissToken } from '../../../src/platform/AlarmBackend';
import type { Alarm } from '../../../src/core/types';
import { createAlarm, defaultSettings, MAX_SILENCE_LEASE_MS, NATIVE_MIRROR_VERSION } from '../../../src/core/defaults';

type Listener = (data: unknown) => void;

const mock = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  const fn = () => vi.fn();
  const plugin = {
    syncAlarms: fn(),
    getNextFire: fn(),
    getHealth: fn(),
    requestFix: fn(),
    testAlarm: fn(),
    getPendingTest: fn(),
    cancelTest: fn(),
    getActiveRing: fn(),
    missionUiReady: fn(),
    setSilenced: fn(),
    snooze: fn(),
    dismiss: fn(),
    confirmAwake: fn(),
    getLog: fn(),
    ackLog: fn(),
    listSounds: fn(),
    previewSound: fn(),
    stopPreview: fn(),
    pickCustomSound: fn(),
    deleteCustomSound: fn(),
    getDiagnostics: fn(),
    removeAllListeners: fn(),
    addListener: vi.fn(async (name: string, l: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), l]);
      return { remove: async () => undefined };
    }),
  };
  const emit = (name: string, data: unknown) => {
    for (const l of listeners.get(name) ?? []) l(data);
  };
  return { plugin, listeners, emit };
});

vi.mock('../../../src/platform/native/RousePlugin', () => ({ Rouse: mock.plugin }));

import { createNativeAlarmBackend, getNativeDiagnostics, toNativeSettings } from '../../../src/platform/native/NativeAlarmBackend';

const alarm: Alarm = createAlarm({ id: 'a1', now: 1_700_000_000_000 });

const ring: ActiveRing = {
  sessionId: 's1',
  alarmId: 'a1',
  alarm,
  source: 'scheduled',
  state: 'ringing',
  scheduledFor: 1_760_000_000_000,
  episodeStartedAt: 1_760_000_000_100,
  ringStartedAt: 1_760_000_000_100,
  snoozeCount: 0,
  snoozeUntil: null,
  wakeCheckAt: null,
  wakeCheckDeadlineAt: null,
  wakeCheckReRings: 0,
  silenced: false,
  nativeFallbackShown: false,
  isTest: false,
};

describe('NativeAlarmBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.listeners.clear();
  });

  it('declares native capabilities', () => {
    const b = createNativeAlarmBackend();
    expect(b.kind).toBe('native');
    expect(b.capabilities).toEqual({ canWakeLockedDevice: true, canLockVolume: true, canPickCustomSound: true, hasNativeFallback: true });
  });

  it('sync sends the full mirror and passes the result through', async () => {
    const settings = defaultSettings();
    settings.bedtimeReminder = { enabled: true, sleepGoalMin: 450 };
    settings.silenceWhileSolvingSec = 25;
    const result = {
      next: { alarmId: 'a1', alarmIds: ['a1'], fireAt: 5 },
      alarms: [{ alarmId: 'a1', nextFireAt: 5 }],
      bedtimeReminderAt: null,
    };
    mock.plugin.syncAlarms.mockResolvedValue(result);
    const disabled = { ...alarm, id: 'a2', enabled: false };
    const r = await createNativeAlarmBackend().sync([alarm, disabled], settings);
    expect(mock.plugin.syncAlarms).toHaveBeenCalledWith({
      mirrorVersion: NATIVE_MIRROR_VERSION,
      alarms: [alarm, disabled],
      settings: { bedtimeReminder: { enabled: true, sleepGoalMin: 450 }, silenceLeaseMs: 25_000 },
    });
    expect(r).toEqual(result);
  });

  it('toNativeSettings converts seconds to ms', () => {
    expect(toNativeSettings(defaultSettings()).silenceLeaseMs).toBe(30_000);
  });

  it('unwraps single-field results', async () => {
    const b = createNativeAlarmBackend();
    mock.plugin.getNextFire.mockResolvedValue({ next: null });
    expect(await b.getNextFire()).toBeNull();
    mock.plugin.getActiveRing.mockResolvedValue({ ring });
    expect(await b.getActiveRing()).toEqual(ring);
    mock.plugin.getActiveRing.mockResolvedValue({ ring: null });
    expect(await b.getActiveRing()).toBeNull();
    mock.plugin.requestFix.mockResolvedValue({ outcome: 'settings-opened' });
    expect(await b.requestFix('batteryOptimization')).toBe('settings-opened');
    expect(mock.plugin.requestFix).toHaveBeenCalledWith({ id: 'batteryOptimization' });
    const events = [{ seq: 3, at: 1, sessionId: 's1', alarmId: 'a1', type: 'one-off-consumed' }];
    mock.plugin.getLog.mockResolvedValue({ events, lastSeq: 3 });
    expect(await b.getLog(2)).toEqual(events);
    expect(mock.plugin.getLog).toHaveBeenCalledWith({ afterSeq: 2 });
    const sounds = [{ ref: { kind: 'bundled', id: 'classic' }, name: 'Classic beep', durationMs: 1200 }];
    mock.plugin.listSounds.mockResolvedValue({ sounds });
    expect(await b.listSounds()).toEqual(sounds);
    mock.plugin.pickCustomSound.mockResolvedValue({ sound: null });
    expect(await b.pickCustomSound()).toBeNull();
    mock.plugin.getDiagnostics.mockResolvedValue({ lines: ['x'] });
    expect(await getNativeDiagnostics()).toEqual(['x']);
  });

  it('passes health, test alarm and snooze results through', async () => {
    const b = createNativeAlarmBackend();
    const health = { platform: 'android', sdkInt: 35, manufacturer: 'google', checks: [], checkedAt: 1 };
    mock.plugin.getHealth.mockResolvedValue(health);
    expect(await b.getHealth()).toEqual(health);
    mock.plugin.testAlarm.mockResolvedValue({ fireAt: 99 });
    expect(await b.testAlarm(alarm, 60)).toEqual({ fireAt: 99 });
    expect(mock.plugin.testAlarm).toHaveBeenCalledWith({ alarm, delaySeconds: 60 });
    mock.plugin.snooze.mockResolvedValue({ snoozeUntil: 123 });
    expect(await b.snooze('s1')).toEqual({ snoozeUntil: 123 });
    expect(mock.plugin.snooze).toHaveBeenCalledWith({ sessionId: 's1' });
  });

  it('getPendingTest unwraps { fireAt }, null when nothing is pending; cancelTest calls the plugin', async () => {
    const b = createNativeAlarmBackend();
    mock.plugin.getPendingTest.mockResolvedValue({ fireAt: 4242 });
    expect(await b.getPendingTest()).toEqual({ fireAt: 4242 });
    mock.plugin.getPendingTest.mockResolvedValue({ fireAt: null });
    expect(await b.getPendingTest()).toBeNull();
    mock.plugin.cancelTest.mockResolvedValue(undefined);
    await expect(b.cancelTest()).resolves.toBeUndefined();
    expect(mock.plugin.cancelTest).toHaveBeenCalledTimes(1);
    mock.plugin.cancelTest.mockRejectedValue(Object.assign(new Error('io'), { code: 'IO_ERROR' }));
    await expect(b.cancelTest()).rejects.toMatchObject({ code: 'IO_ERROR' });
  });

  it('getDiagnostics combines health, schedule, episode and the native log, without alarm labels', async () => {
    const b = createNativeAlarmBackend();
    const labelled: ActiveRing = { ...ring, alarm: { ...alarm, label: 'My secret label' } };
    mock.plugin.getHealth.mockResolvedValue({
      platform: 'android',
      sdkInt: 35,
      manufacturer: 'google',
      checks: [{ id: 'exactAlarm', state: 'ok', severity: 'critical', fix: 'none', detail: 'Allowed' }],
      checkedAt: 1_760_000_000_000,
    });
    mock.plugin.getNextFire.mockResolvedValue({ next: { alarmId: 'a1', alarmIds: ['a1', 'a2'], fireAt: 1_760_000_100_000 } });
    mock.plugin.getPendingTest.mockResolvedValue({ fireAt: 1_760_000_200_000 });
    mock.plugin.getActiveRing.mockResolvedValue({ ring: labelled });
    mock.plugin.getDiagnostics.mockResolvedValue({ lines: ['2026-10-15T05:00:00.000Z I ring: ringing source=scheduled test=false fg=true'] });
    const text = await b.getDiagnostics();
    expect(text).toMatch(/^Rouse diagnostics · android · /);
    expect(text).toContain('sdk: 35 · maker: google');
    expect(text).toContain('exactAlarm: ok (critical)');
    expect(text).toContain(`next fire: ${new Date(1_760_000_100_000).toISOString()} (2 alarms)`);
    expect(text).toContain(`pending test: ${new Date(1_760_000_200_000).toISOString()}`);
    expect(text).toContain('episode: ringing · source scheduled · test false');
    expect(text).toContain('[log] last 1 lines');
    expect(text).toContain('I ring: ringing source=scheduled');
    expect(text).not.toContain('My secret label');
    expect(text).not.toContain('[unavailable]');
  });

  it('getDiagnostics still reports when some sources fail', async () => {
    const b = createNativeAlarmBackend();
    mock.plugin.getHealth.mockRejectedValue(new Error('nope'));
    mock.plugin.getNextFire.mockResolvedValue({ next: null });
    mock.plugin.getPendingTest.mockResolvedValue({ fireAt: null });
    mock.plugin.getActiveRing.mockResolvedValue({ ring: null });
    mock.plugin.getDiagnostics.mockRejectedValue(new Error('nope'));
    const text = await b.getDiagnostics();
    expect(text).toContain('[health]\nunavailable');
    expect(text).toContain('next fire: none');
    expect(text).toContain('pending test: none');
    expect(text).toContain('episode: none');
    expect(text).toContain('[unavailable] health, log');
  });

  it('maps ring-session calls to plugin arguments', async () => {
    const b = createNativeAlarmBackend();
    await b.missionUiReady('s1');
    expect(mock.plugin.missionUiReady).toHaveBeenCalledWith({ sessionId: 's1' });
    await b.setSilenced('s1', true, 30_000);
    expect(mock.plugin.setSilenced).toHaveBeenCalledWith({ sessionId: 's1', silenced: true, leaseMs: 30_000 });
    await b.setSilenced('s1', true, 10 * MAX_SILENCE_LEASE_MS);
    expect(mock.plugin.setSilenced).toHaveBeenLastCalledWith({ sessionId: 's1', silenced: true, leaseMs: MAX_SILENCE_LEASE_MS });
    await b.confirmAwake('s1');
    expect(mock.plugin.confirmAwake).toHaveBeenCalledWith({ sessionId: 's1' });
    await b.ackLog(7);
    expect(mock.plugin.ackLog).toHaveBeenCalledWith({ throughSeq: 7 });
    await b.previewSound({ kind: 'bundled', id: 'siren' }, 40);
    expect(mock.plugin.previewSound).toHaveBeenCalledWith({ sound: { kind: 'bundled', id: 'siren' }, volume: 40 });
    await b.stopPreview();
    expect(mock.plugin.stopPreview).toHaveBeenCalled();
    await b.deleteCustomSound('c1');
    expect(mock.plugin.deleteCustomSound).toHaveBeenCalledWith({ id: 'c1' });
  });

  it('dismiss unwraps the token', async () => {
    mock.plugin.dismiss.mockResolvedValue({ wakeCheckAt: 777 });
    const token = { sessionId: 's1', via: 'mission' } as DismissToken;
    expect(await createNativeAlarmBackend().dismiss(token)).toEqual({ wakeCheckAt: 777 });
    expect(mock.plugin.dismiss).toHaveBeenCalledWith({ sessionId: 's1', via: 'mission' });
  });

  it('propagates plugin errors (code preserved)', async () => {
    const err = Object.assign(new Error('No snoozes left'), { code: 'SNOOZE_NOT_ALLOWED' });
    mock.plugin.snooze.mockRejectedValue(err);
    await expect(createNativeAlarmBackend().snooze('s1')).rejects.toMatchObject({ code: 'SNOOZE_NOT_ALLOWED' });
  });

  it('maps every plugin event to a BackendEvent', async () => {
    const b = createNativeAlarmBackend();
    const got: BackendEvent[] = [];
    const unsubscribe = b.subscribe((e) => got.push(e));
    await b.init();
    await b.init(); // idempotent
    expect(mock.plugin.addListener).toHaveBeenCalledTimes(5);
    mock.emit('ring', { ring });
    mock.emit('wakeCheck', { ring: { ...ring, state: 'wake-check-prompt' } });
    mock.emit('ringState', { ring: null });
    mock.emit('log', { lastSeq: 4 });
    mock.emit('healthChanged', {});
    expect(got).toEqual([
      { type: 'ring', ring },
      { type: 'wake-check', ring: { ...ring, state: 'wake-check-prompt' } },
      { type: 'ring-state', ring: null },
      { type: 'log' },
      { type: 'health-changed' },
    ]);
    unsubscribe();
    mock.emit('log', { lastSeq: 5 });
    expect(got).toHaveLength(5);
  });

  it('isolates a throwing listener', async () => {
    const b = createNativeAlarmBackend();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    b.subscribe(() => {
      throw new Error('boom');
    });
    b.subscribe(good);
    await b.init();
    mock.emit('log', { lastSeq: 1 });
    expect(good).toHaveBeenCalledWith({ type: 'log' });
    spy.mockRestore();
  });
});
