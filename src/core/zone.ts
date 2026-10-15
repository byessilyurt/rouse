/**
 * Time-zone offset abstraction. OWNER: core agent. API is part of the contract.
 *
 * All schedule math takes a ZoneOffsetFn so tests can run any IANA zone regardless of the
 * process TZ, and so the algorithm in docs/plan.md §3.6 is explicit (Java uses java.time,
 * which has the same gap/overlap semantics).
 */
import type { EpochMs } from './types';
import { notImplemented } from './notImplemented';

/** Offset of local wall time from UTC at instant `epochMs`, in MINUTES, east positive (CET = +60, New York EST = -300). */
export type ZoneOffsetFn = (epochMs: EpochMs) => number;

/** The device's zone, via Date#getTimezoneOffset (which is west-positive, hence the minus). */
export const localZone: ZoneOffsetFn = (epochMs) => -new Date(epochMs).getTimezoneOffset();

/** Zone for an IANA id (e.g. 'America/New_York') using Intl.DateTimeFormat. For tests and vectors. */
export function ianaZone(timeZone: string): ZoneOffsetFn {
  return notImplemented(`ianaZone(${timeZone})`);
}
