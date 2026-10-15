/**
 * Time-zone offset abstraction. OWNER: core agent. API is part of the contract.
 *
 * All schedule math takes a ZoneOffsetFn so tests can run any IANA zone regardless of the
 * process TZ, and so the algorithm in docs/plan.md §3.6 is explicit (Java uses java.time,
 * which has the same gap/overlap semantics).
 */
import type { EpochMs } from './types';

/** Offset of local wall time from UTC at instant `epochMs`, in MINUTES, east positive (CET = +60, New York EST = -300). */
export type ZoneOffsetFn = (epochMs: EpochMs) => number;

/** The device's zone, via Date#getTimezoneOffset (which is west-positive, hence the minus). */
export const localZone: ZoneOffsetFn = (epochMs) => -new Date(epochMs).getTimezoneOffset();

const zoneCache = new Map<string, ZoneOffsetFn>();

/** Zone for an IANA id (e.g. 'America/New_York') using Intl.DateTimeFormat. For tests and vectors. */
export function ianaZone(timeZone: string): ZoneOffsetFn {
  const cached = zoneCache.get(timeZone);
  if (cached) return cached;

  // Throws RangeError for an unknown zone id, which is what callers want.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    era: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });

  const fn: ZoneOffsetFn = (epochMs) => {
    // Intl has second resolution: compare against the instant truncated to the whole second.
    const instant = epochMs - (((epochMs % 1000) + 1000) % 1000);
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(instant))) parts[p.type] = p.value;
    let year = Number(parts.year);
    if (parts.era === 'BC' || parts.era === 'B') year = 1 - year;
    const hour = Number(parts.hour) % 24; // some engines print 24 for midnight
    const wall = new Date(0);
    wall.setUTCFullYear(year, Number(parts.month) - 1, Number(parts.day));
    wall.setUTCHours(hour, Number(parts.minute), Number(parts.second), 0);
    return (wall.getTime() - instant) / 60_000;
  };
  zoneCache.set(timeZone, fn);
  return fn;
}
