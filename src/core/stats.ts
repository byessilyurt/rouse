/**
 * Local statistics. OWNER: core agent. API is part of the contract.
 */
import type { EpochMs, WakeRecord } from './types';
import type { ZoneOffsetFn } from './zone';
import { localZone } from './zone';
import { notImplemented } from './notImplemented';

export interface DaySummary {
  /** Local date 'YYYY-MM-DD'. */
  date: string;
  /** Earliest dismissal that day, null if none. */
  dismissedAt: EpochMs | null;
  snoozes: number;
  missed: number;
}

export interface WakeStats {
  episodes: number;
  dismissed: number;
  missed: number;
  avgSnoozes: number;
  avgMissionTimeMs: number;
  /** dismissedAt − scheduledFor, averaged over dismissed episodes with scheduledFor. */
  avgMinutesToUp: number;
  fallbackRate: number;
  /** confirmed / (confirmed + failed); null if no wake checks. */
  wakeCheckPassRate: number | null;
  /** Consecutive local days ending today (or yesterday) where every episode was dismissed and no wake check failed. */
  currentStreakDays: number;
  bestStreakDays: number;
  /** Last 14 local days, oldest first. */
  last14Days: DaySummary[];
}

export function computeStats(records: readonly WakeRecord[], now: EpochMs, zone: ZoneOffsetFn = localZone): WakeStats {
  return notImplemented(`computeStats(${records.length}, ${now}, ${typeof zone})`);
}
