import { describe, expect, it } from 'vitest';
import { normalizeAlarm, parseAlarm, parseMission, parseSettings, validateAlarm } from '../../../src/core/validation';
import { DEFAULT_SOUND, LIMITS, MAX_CUSTOM_PHRASE_LENGTH, MAX_LABEL_LENGTH, defaultMissionConfig, defaultSettings } from '../../../src/core/defaults';
import type { Alarm, MissionConfig } from '../../../src/core/types';
import { makeAlarm } from './testUtils';

const paths = (a: Alarm): string[] => validateAlarm(a).map((i) => i.path);

type Setter = (a: Alarm, v: number) => Alarm;
const numericFields: [string, Setter, { min: number; max: number }][] = [
  ['hour', (a, v) => ({ ...a, hour: v }), { min: 0, max: 23 }],
  ['minute', (a, v) => ({ ...a, minute: v }), { min: 0, max: 59 }],
  ['volume', (a, v) => ({ ...a, volume: v }), LIMITS.volume],
  ['volumeRampSec', (a, v) => ({ ...a, volumeRampSec: v }), LIMITS.volumeRampSec],
  ['snooze.intervalMin', (a, v) => ({ ...a, snooze: { ...a.snooze, intervalMin: v } }), LIMITS.snoozeIntervalMin],
  ['snooze.maxCount', (a, v) => ({ ...a, snooze: { ...a.snooze, maxCount: v } }), LIMITS.snoozeMaxCount],
  ['wakeUpCheck.delayMin', (a, v) => ({ ...a, wakeUpCheck: { ...a.wakeUpCheck, delayMin: v } }), LIMITS.wakeCheckDelayMin],
  ['wakeUpCheck.windowMin', (a, v) => ({ ...a, wakeUpCheck: { ...a.wakeUpCheck, windowMin: v } }), LIMITS.wakeCheckWindowMin],
];

const withMission = (m: MissionConfig): Alarm => makeAlarm({ missions: [m] });
const missionFields: [string, (v: number) => MissionConfig, { min: number; max: number }][] = [
  ['missions.0.difficulty', (v) => ({ type: 'math', difficulty: v as 1, count: 3 }), LIMITS.math.difficulty],
  ['missions.0.count', (v) => ({ type: 'math', difficulty: 2, count: v }), LIMITS.math.count],
  ['missions.0.gridSize', (v) => ({ type: 'memory', gridSize: v as 3, rounds: 2 }), LIMITS.memory.gridSize],
  ['missions.0.rounds', (v) => ({ type: 'memory', gridSize: 4, rounds: v }), LIMITS.memory.rounds],
  ['missions.0.phrases', (v) => ({ ...defaultMissionConfig('typing'), phrases: v }), LIMITS.typing.phrases],
  ['missions.0.count', (v) => ({ type: 'shake', count: v, sensitivity: 'medium' }), LIMITS.shake.count],
  ['missions.0.targets', (v) => ({ type: 'tap', targets: v }), LIMITS.tap.targets],
  ['missions.0.count', (v) => ({ type: 'steps', count: v }), LIMITS.steps.count],
  ['missions.0.count', (v) => ({ type: 'squat', count: v }), LIMITS.squat.count],
];

describe('validateAlarm', () => {
  it('accepts the default alarm', () => {
    expect(validateAlarm(makeAlarm())).toEqual([]);
  });

  it.each(numericFields)('%s: bounds ±1', (path, set, range) => {
    const a = makeAlarm();
    expect(paths(set(a, range.min))).not.toContain(path);
    expect(paths(set(a, range.max))).not.toContain(path);
    expect(paths(set(a, range.min - 1))).toContain(path);
    expect(paths(set(a, range.max + 1))).toContain(path);
    expect(paths(set(a, range.min + 0.5))).toContain(path);
  });

  it.each(missionFields)('%s: bounds ±1', (path, make, range) => {
    expect(paths(withMission(make(range.min)))).not.toContain(path);
    expect(paths(withMission(make(range.max)))).not.toContain(path);
    expect(paths(withMission(make(range.min - 1)))).toContain(path);
    expect(paths(withMission(make(range.max + 1)))).toContain(path);
  });

  it('label length', () => {
    expect(paths(makeAlarm({ label: 'x'.repeat(MAX_LABEL_LENGTH) }))).toEqual([]);
    expect(paths(makeAlarm({ label: 'x'.repeat(MAX_LABEL_LENGTH + 1) }))).toEqual(['label']);
  });

  it('days must be sorted, unique, 0..6', () => {
    expect(paths(makeAlarm({ days: [] }))).toEqual([]);
    expect(paths(makeAlarm({ days: [0, 6] }))).toEqual([]);
    expect(paths(makeAlarm({ days: [2, 1] }))).toEqual(['days']);
    expect(paths(makeAlarm({ days: [1, 1] }))).toEqual(['days']);
    expect(paths(makeAlarm({ days: [7 as 0] }))).toEqual(['days.0']);
    expect(paths(makeAlarm({ days: [-1 as 0] }))).toEqual(['days.0']);
  });

  it('at most 3 missions', () => {
    const m = defaultMissionConfig('math');
    expect(paths(makeAlarm({ missions: [m, m, m] }))).toEqual([]);
    expect(paths(makeAlarm({ missions: [m, m, m, m] }))).toEqual(['missions']);
  });

  it('QR needs a registered code', () => {
    expect(paths(withMission({ type: 'qr', expectedCode: '', label: '' }))).toEqual(['missions.0.expectedCode']);
    expect(paths(withMission({ type: 'qr', expectedCode: ' ​ ', label: '' }))).toEqual(['missions.0.expectedCode']);
    expect(paths(withMission({ type: 'qr', expectedCode: 'ABC', label: 'Sink' }))).toEqual([]);
  });

  it('custom typing phrase must be 1..200 chars after trimming; ignored in random mode', () => {
    const t = defaultMissionConfig('typing');
    expect(paths(withMission({ ...t, phraseMode: 'custom', customPhrase: '   ' }))).toEqual(['missions.0.customPhrase']);
    expect(paths(withMission({ ...t, phraseMode: 'custom', customPhrase: ' x ' }))).toEqual([]);
    expect(paths(withMission({ ...t, phraseMode: 'custom', customPhrase: 'x'.repeat(MAX_CUSTOM_PHRASE_LENGTH) }))).toEqual([]);
    expect(paths(withMission({ ...t, phraseMode: 'custom', customPhrase: 'x'.repeat(MAX_CUSTOM_PHRASE_LENGTH + 1) }))).toEqual(['missions.0.customPhrase']);
    expect(paths(withMission({ ...t, phraseMode: 'random', customPhrase: '' }))).toEqual([]);
  });

  it('flags bad sounds, types and unknown missions', () => {
    expect(paths(makeAlarm({ sound: { kind: 'bundled', id: 'nope' as 'classic' } }))).toEqual(['sound.id']);
    expect(paths(makeAlarm({ sound: { kind: 'custom', id: '', name: 'x' } }))).toEqual(['sound.id']);
    expect(paths(makeAlarm({ sound: { kind: 'other' } as never }))).toEqual(['sound.kind']);
    expect(paths(makeAlarm({ missions: [{ type: 'photo' } as never] }))).toEqual(['missions.0.type']);
    expect(paths(makeAlarm({ enabled: 'yes' as never, id: '' }))).toEqual(['id', 'enabled']);
    expect(paths(makeAlarm({ snooze: null as never, wakeUpCheck: undefined as never }))).toEqual(['snooze', 'wakeUpCheck']);
    expect(paths(withMission({ type: 'shake', count: 30, sensitivity: 'max' as 'low' }))).toEqual(['missions.0.sensitivity']);
    expect(paths(makeAlarm({ skipUntil: Number.NaN }))).toEqual(['skipUntil']);
  });
});

describe('normalizeAlarm', () => {
  it('clamps, sorts days, trims the label, normalises QR codes, and never throws', () => {
    const a = normalizeAlarm(
      makeAlarm({
        hour: 25,
        minute: -3,
        days: [5, 1, 5, 9 as 0],
        label: 'y'.repeat(80),
        volume: 5,
        volumeRampSec: 1000,
        snooze: { enabled: true, intervalMin: 0, maxCount: 99, requireMission: false },
        wakeUpCheck: { enabled: true, delayMin: 99, windowMin: 0 },
        missions: [
          { type: 'math', difficulty: 9 as 1, count: 0 },
          { type: 'qr', expectedCode: '﻿code\r\n', label: 'x' },
          { type: 'tap', targets: 7.6 },
        ],
      }),
    );
    expect(a).toMatchObject({ hour: 23, minute: 0, days: [1, 5], volume: 10, volumeRampSec: 300 });
    expect(a.label).toHaveLength(MAX_LABEL_LENGTH);
    expect(a.snooze).toMatchObject({ intervalMin: 1, maxCount: 10 });
    expect(a.wakeUpCheck).toMatchObject({ delayMin: 30, windowMin: 1 });
    expect(a.missions).toEqual([
      { type: 'math', difficulty: 5, count: 1 },
      { type: 'qr', expectedCode: 'code', label: 'x' },
      { type: 'tap', targets: 8 },
    ]);
    expect(validateAlarm(a)).toEqual([]);
    expect(() => normalizeAlarm({} as Alarm)).not.toThrow();
  });
});

describe('parseAlarm', () => {
  it('round-trips a valid alarm', () => {
    const a = makeAlarm({ label: 'Gym', days: [1, 3], skipUntil: 123 });
    expect(parseAlarm(JSON.parse(JSON.stringify(a)))).toEqual({ ok: true, alarm: a });
  });
  it('fills defaults for missing optional fields', () => {
    const r = parseAlarm({ id: 'x', hour: 6, minute: 15 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.alarm).toMatchObject({ id: 'x', hour: 6, minute: 15, enabled: true, days: [1, 2, 3, 4, 5], skipUntil: null });
      expect(validateAlarm(r.alarm)).toEqual([]);
    }
  });
  it('fills mission fields, clamps numbers, defaults unknown bundled sounds', () => {
    const r = parseAlarm({ id: 'x', hour: 6, minute: 0, volume: 500, sound: { kind: 'bundled', id: 'future' }, missions: [{ type: 'math', count: 50 }] });
    expect(r.ok && r.alarm.volume).toBe(100);
    expect(r.ok && r.alarm.sound).toEqual(DEFAULT_SOUND);
    expect(r.ok && r.alarm.missions).toEqual([{ type: 'math', difficulty: 2, count: 20 }]);
  });
  it('rejects non-objects, missing required fields, wrong types and remaining invalid data', () => {
    expect(parseAlarm(null).ok).toBe(false);
    expect(parseAlarm([]).ok).toBe(false);
    const missing = parseAlarm({ hour: 'x' });
    expect(!missing.ok && missing.issues.map((i) => i.path)).toEqual(['id', 'hour', 'minute']);
    const wrong = parseAlarm({ id: 'x', hour: 1, minute: 2, enabled: 'yes', days: 'mon' });
    expect(!wrong.ok && wrong.issues.map((i) => i.path)).toEqual(['enabled', 'days']);
    const qr = parseAlarm({ id: 'x', hour: 1, minute: 2, missions: [{ type: 'qr' }] });
    expect(!qr.ok && qr.issues[0]?.path).toBe('missions.0.expectedCode');
    const unknown = parseAlarm({ id: 'x', hour: 1, minute: 2, missions: [{ type: 'nfc' }] });
    expect(!unknown.ok && unknown.issues[0]?.path).toBe('missions.0.type');
  });
  it('parseMission returns null for unknown shapes', () => {
    expect(parseMission('math')).toBeNull();
    expect(parseMission({ type: 'nfc' })).toBeNull();
    expect(parseMission({ type: 'shake', count: Number.POSITIVE_INFINITY })).toEqual(defaultMissionConfig('shake'));
  });
});

describe('parseSettings', () => {
  it('returns defaults for garbage', () => {
    expect(parseSettings(undefined)).toEqual(defaultSettings());
    expect(parseSettings('x')).toEqual(defaultSettings());
    expect(parseSettings({})).toEqual(defaultSettings());
  });
  it('round-trips valid settings', () => {
    const s = { ...defaultSettings(), theme: 'dark' as const, napMinutes: 45, weekStartsOn: 0 as const, onboardingDone: true };
    expect(parseSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('replaces each invalid field independently and clamps numbers', () => {
    const d = defaultSettings();
    const s = parseSettings({
      theme: 'neon',
      clockFormat: '24h',
      silenceWhileSolvingSec: 5,
      napMinutes: 1000,
      fallback: { afterFailures: 0, afterMinutes: 'x', mission: { type: 'qr', expectedCode: 'a' } },
      bedtimeReminder: { enabled: true, sleepGoalMin: 100 },
      alarmDefaults: { volume: 3, missions: [{ type: 'math' }, { type: 'qr' }, 'x'], snooze: { intervalMin: 999 } },
    });
    expect(s.theme).toBe(d.theme);
    expect(s.clockFormat).toBe('24h');
    expect(s.silenceWhileSolvingSec).toBe(LIMITS.silenceWhileSolvingSec.min);
    expect(s.napMinutes).toBe(LIMITS.napMinutes.max);
    expect(s.fallback).toEqual({ afterFailures: 1, afterMinutes: d.fallback.afterMinutes, mission: d.fallback.mission });
    expect(s.bedtimeReminder).toEqual({ enabled: true, sleepGoalMin: 240 });
    expect(s.alarmDefaults.volume).toBe(10);
    expect(s.alarmDefaults.missions).toEqual([defaultMissionConfig('math')]); // unregistered QR dropped
    expect(s.alarmDefaults.snooze.intervalMin).toBe(60);
  });
  it('accepts a valid fallback mission', () => {
    const s = parseSettings({ fallback: { mission: { type: 'math', difficulty: 3, count: 20 } } });
    expect(s.fallback.mission).toEqual({ type: 'math', difficulty: 3, count: 20 });
  });
});
