/**
 * Scheduling math. OWNER: core agent. API is part of the contract.
 * The algorithm MUST match docs/plan.md §3.6 exactly; Java implements the same and both are
 * tested against tests/fixtures/next-fire-vectors.json.
 */
import type { Alarm, BedtimeReminderSettings, EpochMs, NextFire, Weekday } from './types';
import type { ZoneOffsetFn } from './zone';
import { localZone } from './zone';

/** A calendar date in the local zone. month is 1..12. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** §3.6: search today plus the next 14 local dates. */
const SEARCH_DAYS = 15;

/** Date.UTC that also works for years 0..99 (Date.UTC maps those to 19xx). */
function utcMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, 0, 0);
  return d.getTime();
}

function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(utcMs(date.year, date.month, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Local calendar date of `epochMs` in `zone`. */
export function localDateOf(epochMs: EpochMs, zone: ZoneOffsetFn = localZone): LocalDate {
  const wall = new Date(epochMs + zone(epochMs) * MINUTE_MS);
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() };
}

/** Day of week of a local date (0 = Sunday). */
export function weekdayOf(date: LocalDate): Weekday {
  return new Date(utcMs(date.year, date.month, date.day)).getUTCDay() as Weekday;
}

/**
 * Instant of wall time `hour:minute` on `date` in `zone`.
 * Gap (spring forward): shifted later by the gap length (02:30 → 03:30). Overlap (fall back): earlier instant.
 */
export function wallTimeToEpoch(date: LocalDate, hour: number, minute: number, zone: ZoneOffsetFn = localZone): EpochMs {
  const wall = utcMs(date.year, date.month, date.day, hour, minute);
  // Candidates use the offsets in force a day before and a day after (§3.6).
  const c1 = wall - zone(wall - DAY_MS) * MINUTE_MS;
  const c2 = wall - zone(wall + DAY_MS) * MINUTE_MS;
  const valid = (c: number): boolean => c + zone(c) * MINUTE_MS === wall;
  const v1 = valid(c1);
  const v2 = valid(c2);
  if (v1 && v2) return Math.min(c1, c2); // overlap → earlier instant (or no transition: c1 === c2)
  if (v1) return c1;
  if (v2) return c2;
  return c1; // gap → the pre-transition offset pushes the instant later by the gap length
}

/**
 * Next instant strictly after `now` at which this alarm would ring, honouring days and
 * skipUntil. IGNORES `enabled` (so the editor can show "would ring in …"). null only if no
 * occurrence within the 15-day search window (cannot happen for valid alarms).
 */
export function nextOccurrence(
  alarm: Pick<Alarm, 'hour' | 'minute' | 'days' | 'skipUntil'>,
  now: EpochMs,
  zone: ZoneOffsetFn = localZone,
): EpochMs | null {
  const start = localDateOf(now, zone);
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const date = addDays(start, i);
    if (alarm.days.length > 0 && !alarm.days.includes(weekdayOf(date))) continue;
    const t = wallTimeToEpoch(date, alarm.hour, alarm.minute, zone);
    if (t <= now) continue;
    if (alarm.skipUntil !== null && t <= alarm.skipUntil) continue;
    return t;
  }
  return null;
}

/** Ordering used for merged rings: lowest createdAt, then lowest id. */
function compareAlarms(a: Pick<Alarm, 'createdAt' | 'id'>, b: Pick<Alarm, 'createdAt' | 'id'>): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Earliest next occurrence across ENABLED alarms; ties merged (alarmId = lowest createdAt, then id). */
export function nextFire(alarms: readonly Alarm[], now: EpochMs, zone: ZoneOffsetFn = localZone): NextFire | null {
  let fireAt: EpochMs | null = null;
  let due: Alarm[] = [];
  for (const alarm of alarms) {
    if (!alarm.enabled) continue;
    const t = nextOccurrence(alarm, now, zone);
    if (t === null) continue;
    if (fireAt === null || t < fireAt) {
      fireAt = t;
      due = [alarm];
    } else if (t === fireAt) {
      due.push(alarm);
    }
  }
  if (fireAt === null || due.length === 0) return null;
  due.sort(compareAlarms);
  const alarmIds = due.map((a) => a.id);
  return { alarmId: alarmIds[0] as string, alarmIds, fireAt };
}

/** Copy of `alarm` whose next occurrence (computed ignoring any current skip) is skipped. */
export function skipNext(alarm: Alarm, now: EpochMs, zone: ZoneOffsetFn = localZone): Alarm {
  const next = nextOccurrence({ ...alarm, skipUntil: null }, now, zone);
  return { ...alarm, skipUntil: next };
}

/** True if a skip is pending (skipUntil !== null && skipUntil > now). */
export function isSkipping(alarm: Pick<Alarm, 'skipUntil'>, now: EpochMs): boolean {
  return alarm.skipUntil !== null && alarm.skipUntil > now;
}

/** Exact snooze end: now + intervalMin minutes (not rounded to the minute). */
export function snoozeUntil(now: EpochMs, intervalMin: number): EpochMs {
  return now + intervalMin * MINUTE_MS;
}

/**
 * Bedtime reminder instant: computed from nextFire over enabled alarms with deleteAfterRing=false.
 * = fireAt − sleepGoalMin; null if disabled, no next fire, fireAt − now > 24 h, or result <= now.
 */
export function bedtimeReminderAt(
  alarms: readonly Alarm[],
  settings: BedtimeReminderSettings,
  now: EpochMs,
  zone: ZoneOffsetFn = localZone,
): EpochMs | null {
  if (!settings.enabled) return null;
  const next = nextFire(
    alarms.filter((a) => !a.deleteAfterRing),
    now,
    zone,
  );
  if (next === null || next.fireAt - now > DAY_MS) return null;
  const at = next.fireAt - settings.sleepGoalMin * MINUTE_MS;
  return at > now ? at : null;
}

/** Quick-nap wall time: now + minutes, rounded UP to the next whole minute, in `zone`. */
export function napTime(now: EpochMs, minutes: number, zone: ZoneOffsetFn = localZone): { hour: number; minute: number } {
  const at = Math.ceil((now + minutes * MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const wall = new Date(at + zone(at) * MINUTE_MS);
  return { hour: wall.getUTCHours(), minute: wall.getUTCMinutes() };
}

/** Split a positive duration for "Rings in 7 h 12 min" (minutes rounded UP). */
export function splitDuration(ms: number): { days: number; hours: number; minutes: number } {
  const total = ms > 0 ? Math.ceil(ms / MINUTE_MS) : 0;
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}
