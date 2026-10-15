import { describe, expect, it } from 'vitest';
import { computeStats } from '../../../src/core/stats';
import type { WakeRecord } from '../../../src/core/types';
import { ianaZone } from '../../../src/core/zone';
import { iso } from './testUtils';

const ny = ianaZone('America/New_York');
const utc = ianaZone('UTC');

let n = 0;
function rec(scheduledIso: string, extra: Partial<WakeRecord> = {}): WakeRecord {
  const scheduledFor = iso(scheduledIso);
  return {
    id: `r${++n}`,
    alarmId: 'a',
    label: '',
    scheduledFor,
    firstRangAt: scheduledFor,
    dismissedAt: scheduledFor + 5 * 60_000,
    outcome: 'dismissed',
    snoozeCount: 0,
    missionsCompleted: 1,
    missionTimeMs: 60_000,
    failedAttempts: 0,
    usedFallback: false,
    usedNativeFallback: false,
    wakeCheck: 'off',
    wakeCheckReRings: 0,
    ...extra,
  };
}

describe('computeStats', () => {
  it('empty history', () => {
    const s = computeStats([], iso('2026-10-15T12:00:00Z'), utc);
    expect(s).toMatchObject({
      episodes: 0,
      dismissed: 0,
      missed: 0,
      avgSnoozes: 0,
      avgMissionTimeMs: 0,
      avgMinutesToUp: 0,
      fallbackRate: 0,
      wakeCheckPassRate: null,
      currentStreakDays: 0,
      bestStreakDays: 0,
    });
    expect(s.last14Days).toHaveLength(14);
    expect(s.last14Days[0]?.date).toBe('2026-10-02');
    expect(s.last14Days[13]).toEqual({ date: '2026-10-15', dismissedAt: null, snoozes: 0, missed: 0 });
  });

  it('averages and rates', () => {
    const records = [
      rec('2026-10-13T07:00:00Z', { snoozeCount: 2, missionTimeMs: 30_000, wakeCheck: 'confirmed' }),
      rec('2026-10-14T07:00:00Z', { snoozeCount: 0, missionTimeMs: 90_000, usedFallback: true, wakeCheck: 'failed', dismissedAt: iso('2026-10-14T07:15:00Z') }),
      rec('2026-10-15T07:00:00Z', { outcome: 'missed', dismissedAt: null, firstRangAt: null, missionTimeMs: 0 }),
    ];
    const s = computeStats(records, iso('2026-10-15T12:00:00Z'), utc);
    expect(s.episodes).toBe(3);
    expect(s.dismissed).toBe(2);
    expect(s.missed).toBe(1);
    expect(s.avgSnoozes).toBe(1);
    expect(s.avgMissionTimeMs).toBe(60_000);
    expect(s.avgMinutesToUp).toBe(10);
    expect(s.fallbackRate).toBe(0.5);
    expect(s.wakeCheckPassRate).toBe(0.5);
    expect(s.last14Days[13]).toEqual({ date: '2026-10-15', dismissedAt: null, snoozes: 0, missed: 1 });
    expect(s.last14Days[12]).toMatchObject({ date: '2026-10-14', dismissedAt: iso('2026-10-14T07:15:00Z') });
  });

  it('streak counts consecutive good days ending today; missed breaks it', () => {
    const now = iso('2026-10-15T12:00:00Z');
    const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
    const good = days.map((d) => rec(`${d}T07:00:00Z`));
    expect(computeStats(good, now, utc)).toMatchObject({ currentStreakDays: 6, bestStreakDays: 6 });

    const withMiss = [...good, rec('2026-10-12T08:00:00Z', { outcome: 'missed', dismissedAt: null })];
    expect(computeStats(withMiss, now, utc)).toMatchObject({ currentStreakDays: 3, bestStreakDays: 3 });

    const missedToday = [...good, rec('2026-10-15T08:00:00Z', { outcome: 'missed', dismissedAt: null })];
    expect(computeStats(missedToday, now, utc)).toMatchObject({ currentStreakDays: 0, bestStreakDays: 5 });
  });

  it('a failed wake-up check or a superseded episode breaks the streak', () => {
    const now = iso('2026-10-15T12:00:00Z');
    const r = [rec('2026-10-13T07:00:00Z'), rec('2026-10-14T07:00:00Z', { wakeCheck: 'failed' }), rec('2026-10-15T07:00:00Z')];
    expect(computeStats(r, now, utc)).toMatchObject({ currentStreakDays: 1, bestStreakDays: 1 });
    const s = [rec('2026-10-14T07:00:00Z', { outcome: 'superseded' }), rec('2026-10-15T07:00:00Z')];
    expect(computeStats(s, now, utc).currentStreakDays).toBe(1);
  });

  it('streak ending yesterday still counts; an in-progress episode today does not break it', () => {
    const r = [rec('2026-10-13T07:00:00Z'), rec('2026-10-14T07:00:00Z')];
    expect(computeStats(r, iso('2026-10-15T12:00:00Z'), utc).currentStreakDays).toBe(2);
    const inProgress = [...r, rec('2026-10-15T07:00:00Z', { outcome: 'abandoned', dismissedAt: null })];
    expect(computeStats(inProgress, iso('2026-10-15T07:10:00Z'), utc).currentStreakDays).toBe(2);
    // …but an abandoned episode on a past day is a real failure.
    const old = [rec('2026-10-12T07:00:00Z'), rec('2026-10-13T07:00:00Z', { outcome: 'abandoned' }), rec('2026-10-14T07:00:00Z')];
    expect(computeStats(old, iso('2026-10-15T12:00:00Z'), utc).currentStreakDays).toBe(1);
  });

  it('days without alarms (weekends) neither count nor break a streak', () => {
    // Thu 8, Fri 9, (weekend), Mon 12, Tue 13
    const r = ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13'].map((d) => rec(`${d}T07:00:00Z`));
    expect(computeStats(r, iso('2026-10-13T12:00:00Z'), utc)).toMatchObject({ currentStreakDays: 4, bestStreakDays: 4 });
  });

  it('several episodes on one day: all must be good', () => {
    const r = [rec('2026-10-14T07:00:00Z'), rec('2026-10-15T06:00:00Z'), rec('2026-10-15T14:00:00Z', { outcome: 'missed', dismissedAt: null })];
    expect(computeStats(r, iso('2026-10-15T20:00:00Z'), utc)).toMatchObject({ currentStreakDays: 0, bestStreakDays: 1 });
  });

  it('groups by LOCAL day across DST changes (New York, Nov 1 2026)', () => {
    // 06:30 local every day across the fall-back weekend: 10:30Z before, 11:30Z after.
    const r = [
      rec('2026-10-30T06:30:00-04:00'),
      rec('2026-10-31T06:30:00-04:00'),
      rec('2026-11-01T06:30:00-05:00'),
      rec('2026-11-02T06:30:00-05:00', { snoozeCount: 3 }),
    ];
    const s = computeStats(r, iso('2026-11-02T12:00:00-05:00'), ny);
    expect(s.currentStreakDays).toBe(4);
    expect(s.last14Days.slice(-4).map((d) => d.date)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(s.last14Days[13]?.snoozes).toBe(3);
    // A late-evening local episode belongs to that local day even though it is the next UTC day.
    const late = computeStats([rec('2026-11-02T23:30:00-05:00')], iso('2026-11-02T23:45:00-05:00'), ny);
    expect(late.last14Days[13]?.date).toBe('2026-11-02');
    expect(late.currentStreakDays).toBe(1);
  });

  it('uses firstRangAt when scheduledFor is unknown and ignores future-dated records for streaks', () => {
    const r = [rec('2026-10-14T07:00:00Z', { scheduledFor: null }), rec('2026-10-20T07:00:00Z')];
    const s = computeStats(r, iso('2026-10-15T12:00:00Z'), utc);
    expect(s.currentStreakDays).toBe(1);
    expect(s.avgMinutesToUp).toBe(5);
  });
});
