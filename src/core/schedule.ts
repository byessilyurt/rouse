/**
 * Scheduling math. OWNER: core agent. API is part of the contract.
 * The algorithm MUST match docs/plan.md §3.6 exactly; Java implements the same and both are
 * tested against tests/fixtures/next-fire-vectors.json.
 */
import type { Alarm, BedtimeReminderSettings, EpochMs, NextFire, Weekday } from './types';
import type { ZoneOffsetFn } from './zone';
import { localZone } from './zone';
import { notImplemented } from './notImplemented';

/** A calendar date in the local zone. month is 1..12. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** Local calendar date of `epochMs` in `zone`. */
export function localDateOf(epochMs: EpochMs, zone: ZoneOffsetFn = localZone): LocalDate {
  return notImplemented(`localDateOf(${epochMs}, ${typeof zone})`);
}

/** Day of week of a local date (0 = Sunday). */
export function weekdayOf(date: LocalDate): Weekday {
  return notImplemented(`weekdayOf(${JSON.stringify(date)})`);
}

/**
 * Instant of wall time `hour:minute` on `date` in `zone`.
 * Gap (spring forward): shifted later by the gap length (02:30 → 03:30). Overlap (fall back): earlier instant.
 */
export function wallTimeToEpoch(date: LocalDate, hour: number, minute: number, zone: ZoneOffsetFn = localZone): EpochMs {
  return notImplemented(`wallTimeToEpoch(${JSON.stringify(date)}, ${hour}, ${minute}, ${typeof zone})`);
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
  return notImplemented(`nextOccurrence(${alarm.hour}:${alarm.minute}, ${now}, ${typeof zone})`);
}

/** Earliest next occurrence across ENABLED alarms; ties merged (alarmId = lowest createdAt, then id). */
export function nextFire(alarms: readonly Alarm[], now: EpochMs, zone: ZoneOffsetFn = localZone): NextFire | null {
  return notImplemented(`nextFire(${alarms.length}, ${now}, ${typeof zone})`);
}

/** Copy of `alarm` whose next occurrence (computed ignoring any current skip) is skipped. */
export function skipNext(alarm: Alarm, now: EpochMs, zone: ZoneOffsetFn = localZone): Alarm {
  return notImplemented(`skipNext(${alarm.id}, ${now}, ${typeof zone})`);
}

/** True if a skip is pending (skipUntil !== null && skipUntil > now). */
export function isSkipping(alarm: Pick<Alarm, 'skipUntil'>, now: EpochMs): boolean {
  return notImplemented(`isSkipping(${alarm.skipUntil}, ${now})`);
}

/** Exact snooze end: now + intervalMin minutes (not rounded to the minute). */
export function snoozeUntil(now: EpochMs, intervalMin: number): EpochMs {
  return notImplemented(`snoozeUntil(${now}, ${intervalMin})`);
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
  return notImplemented(`bedtimeReminderAt(${alarms.length}, ${settings.enabled}, ${now}, ${typeof zone})`);
}

/** Quick-nap wall time: now + minutes, rounded UP to the next whole minute, in `zone`. */
export function napTime(now: EpochMs, minutes: number, zone: ZoneOffsetFn = localZone): { hour: number; minute: number } {
  return notImplemented(`napTime(${now}, ${minutes}, ${typeof zone})`);
}

/** Split a positive duration for "Rings in 7 h 12 min" (minutes rounded UP). */
export function splitDuration(ms: number): { days: number; hours: number; minutes: number } {
  return notImplemented(`splitDuration(${ms})`);
}
