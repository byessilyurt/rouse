import { describe, expect, it } from 'vitest';
import vectorsFile from '../../fixtures/next-fire-vectors.json';
import {
  bedtimeReminderAt,
  isSkipping,
  localDateOf,
  napTime,
  nextFire,
  nextOccurrence,
  skipNext,
  snoozeUntil,
  splitDuration,
  wallTimeToEpoch,
  weekdayOf,
} from '../../../src/core/schedule';
import type { Weekday } from '../../../src/core/types';
import { ianaZone } from '../../../src/core/zone';
import { iso, makeAlarm } from './testUtils';

interface Vector {
  name: string;
  zone: string;
  nowIso: string;
  alarm: { hour: number; minute: number; days: number[]; skipUntilIso: string | null };
  expectedIso: string | null;
}
const vectors = (vectorsFile as { vectors: Vector[] }).vectors;

const ny = ianaZone('America/New_York');
const berlin = ianaZone('Europe/Berlin');
const utc = ianaZone('UTC');

describe('golden next-fire vectors (shared with Java)', () => {
  it('cover every case required by plan §3.6', () => {
    const names = vectors.map((v) => v.name).join(' ');
    for (const needle of ['ny-spring-gap', 'ny-fall-overlap', 'berlin', 'lord-howe-30min-gap', 'santiago-midnight-gap', 'kolkata', 'skip-next-daily', 'skip-next-weekly', 'boundary', 'feb29']) {
      expect(names).toContain(needle);
    }
    expect(new Set(vectors.map((v) => v.name)).size).toBe(vectors.length);
  });

  it.each(vectors.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    const alarm = {
      hour: v.alarm.hour,
      minute: v.alarm.minute,
      days: v.alarm.days as Weekday[],
      skipUntil: v.alarm.skipUntilIso === null ? null : iso(v.alarm.skipUntilIso),
    };
    const got = nextOccurrence(alarm, iso(v.nowIso), ianaZone(v.zone));
    expect(got === null ? null : new Date(got).toISOString()).toBe(v.expectedIso === null ? null : new Date(iso(v.expectedIso)).toISOString());
  });
});

describe('calendar helpers', () => {
  it('localDateOf uses the zone, not UTC', () => {
    expect(localDateOf(iso('2026-10-16T02:00:00Z'), ny)).toEqual({ year: 2026, month: 10, day: 15 });
    expect(localDateOf(iso('2026-10-16T02:00:00Z'), berlin)).toEqual({ year: 2026, month: 10, day: 16 });
  });
  it('weekdayOf is 0 = Sunday', () => {
    expect(weekdayOf({ year: 2026, month: 3, day: 8 })).toBe(0);
    expect(weekdayOf({ year: 2028, month: 2, day: 29 })).toBe(2);
    expect(weekdayOf({ year: 2026, month: 10, day: 17 })).toBe(6);
  });
  it('wallTimeToEpoch: gap shifts later, overlap picks the earlier instant', () => {
    expect(wallTimeToEpoch({ year: 2026, month: 3, day: 8 }, 2, 30, ny)).toBe(iso('2026-03-08T03:30:00-04:00'));
    expect(wallTimeToEpoch({ year: 2026, month: 11, day: 1 }, 1, 30, ny)).toBe(iso('2026-11-01T01:30:00-04:00'));
    expect(wallTimeToEpoch({ year: 2026, month: 6, day: 1 }, 7, 0, ny)).toBe(iso('2026-06-01T07:00:00-04:00'));
  });
  it('wallTimeToEpoch handles years below 100 without the 19xx quirk', () => {
    expect(new Date(wallTimeToEpoch({ year: 50, month: 1, day: 1 }, 0, 0, utc)).getUTCFullYear()).toBe(50);
  });
});

describe('nextOccurrence', () => {
  it('ignores enabled', () => {
    const now = iso('2026-10-15T06:00:00Z');
    expect(nextOccurrence(makeAlarm({ enabled: false, days: [], hour: 7, minute: 0 }), now, utc)).toBe(iso('2026-10-15T07:00:00Z'));
  });
});

describe('nextFire', () => {
  const now = iso('2026-10-15T06:00:00Z'); // Thursday

  it('returns null with no enabled alarms', () => {
    expect(nextFire([], now, utc)).toBeNull();
    expect(nextFire([makeAlarm({ enabled: false })], now, utc)).toBeNull();
  });

  it('picks the earliest enabled alarm', () => {
    const a = makeAlarm({ id: 'a', hour: 8, minute: 0, days: [] });
    const b = makeAlarm({ id: 'b', hour: 7, minute: 30, days: [] });
    const c = makeAlarm({ id: 'c', hour: 6, minute: 30, days: [], enabled: false });
    expect(nextFire([a, b, c], now, utc)).toEqual({ alarmId: 'b', alarmIds: ['b'], fireAt: iso('2026-10-15T07:30:00Z') });
  });

  it('merges ties sorted by createdAt then id', () => {
    const x = makeAlarm({ id: 'x', hour: 7, minute: 0, days: [], createdAt: 5 });
    const y = makeAlarm({ id: 'y', hour: 7, minute: 0, days: [], createdAt: 2 });
    const z = makeAlarm({ id: 'w', hour: 7, minute: 0, days: [], createdAt: 5 });
    const r = nextFire([x, y, z], now, utc);
    expect(r).toEqual({ alarmId: 'y', alarmIds: ['y', 'w', 'x'], fireAt: iso('2026-10-15T07:00:00Z') });
  });

  it('merges a gap-shifted 02:00 with a 03:00 alarm on spring-forward day', () => {
    const a = makeAlarm({ id: 'two', hour: 2, minute: 0, days: [], createdAt: 2 });
    const b = makeAlarm({ id: 'three', hour: 3, minute: 0, days: [], createdAt: 1 });
    const r = nextFire([a, b], iso('2026-03-07T22:00:00-05:00'), ny);
    expect(r?.alarmIds).toEqual(['three', 'two']);
    expect(r?.fireAt).toBe(iso('2026-03-08T03:00:00-04:00'));
  });

  it('skips alarms with no occurrence in the window', () => {
    const a = makeAlarm({ id: 'a', days: [], skipUntil: iso('2026-12-01T00:00:00Z') });
    expect(nextFire([a], now, utc)).toBeNull();
  });
});

describe('skip next', () => {
  it('skips the upcoming occurrence and is idempotent', () => {
    const now = iso('2026-10-15T06:00:00Z');
    const a = makeAlarm({ hour: 7, minute: 0, days: [] });
    const skipped = skipNext(a, now, utc);
    expect(skipped.skipUntil).toBe(iso('2026-10-15T07:00:00Z'));
    expect(nextOccurrence(skipped, now, utc)).toBe(iso('2026-10-16T07:00:00Z'));
    expect(skipNext(skipped, now, utc).skipUntil).toBe(skipped.skipUntil);
    expect(a.skipUntil).toBeNull(); // input untouched
  });
  it('isSkipping only while the marker is in the future', () => {
    expect(isSkipping({ skipUntil: null }, 10)).toBe(false);
    expect(isSkipping({ skipUntil: 11 }, 10)).toBe(true);
    expect(isSkipping({ skipUntil: 10 }, 10)).toBe(false);
  });
});

describe('snooze, nap, durations', () => {
  it('snoozeUntil is exact', () => {
    expect(snoozeUntil(1_234, 5)).toBe(1_234 + 300_000);
  });
  it('napTime rounds up to the whole minute in the zone', () => {
    expect(napTime(iso('2026-10-15T10:00:30Z'), 20, utc)).toEqual({ hour: 10, minute: 21 });
    expect(napTime(iso('2026-10-15T10:00:00Z'), 20, utc)).toEqual({ hour: 10, minute: 20 });
    expect(napTime(iso('2026-10-15T23:50:00Z'), 20, berlin)).toEqual({ hour: 2, minute: 10 });
    expect(napTime(iso('2026-10-15T23:59:59.001Z'), 0, utc)).toEqual({ hour: 0, minute: 0 });
  });
  it('splitDuration rounds minutes up', () => {
    expect(splitDuration(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(splitDuration(-5)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(splitDuration(1)).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(splitDuration(60_000)).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(splitDuration((7 * 60 + 12) * 60_000 - 500)).toEqual({ days: 0, hours: 7, minutes: 12 });
    expect(splitDuration((26 * 60 + 1) * 60_000)).toEqual({ days: 1, hours: 2, minutes: 1 });
  });
});

describe('bedtimeReminderAt', () => {
  const now = iso('2026-10-15T20:00:00Z');
  const on = { enabled: true, sleepGoalMin: 480 };
  const alarm = makeAlarm({ hour: 7, minute: 0, days: [] });

  it('is fireAt − sleep goal', () => {
    expect(bedtimeReminderAt([alarm], on, now, utc)).toBe(iso('2026-10-15T23:00:00Z'));
  });
  it('is null when disabled, no alarm, too far ahead, or already past', () => {
    expect(bedtimeReminderAt([alarm], { ...on, enabled: false }, now, utc)).toBeNull();
    expect(bedtimeReminderAt([], on, now, utc)).toBeNull();
    expect(bedtimeReminderAt([makeAlarm({ hour: 7, minute: 0, days: [6] })], on, now, utc)).toBeNull(); // Saturday: > 24 h
    expect(bedtimeReminderAt([alarm], on, iso('2026-10-15T23:00:00Z'), utc)).toBeNull(); // result == now
  });
  it('ignores nap alarms (deleteAfterRing)', () => {
    const nap = makeAlarm({ id: 'nap', hour: 21, minute: 0, days: [], deleteAfterRing: true });
    expect(bedtimeReminderAt([nap, alarm], on, now, utc)).toBe(iso('2026-10-15T23:00:00Z'));
  });
  it('exactly 24 h ahead still counts', () => {
    const a = makeAlarm({ hour: 20, minute: 0, days: [] });
    expect(bedtimeReminderAt([a], on, now, utc)).toBe(iso('2026-10-16T12:00:00Z'));
  });
});
