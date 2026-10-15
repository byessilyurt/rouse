/**
 * Local statistics. OWNER: core agent. API is part of the contract.
 */
import type { EpochMs, WakeRecord } from './types';
import type { ZoneOffsetFn } from './zone';
import { localZone } from './zone';
import type { LocalDate } from './schedule';
import { localDateOf } from './schedule';

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

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const dateKey = (d: LocalDate): string => `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;

/** Calendar arithmetic on local dates (never 24 h steps, so DST days are still one day). */
function addDays(d: LocalDate, days: number): LocalDate {
  const x = new Date(0);
  x.setUTCFullYear(d.year, d.month - 1, d.day + days);
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() };
}

/** The instant that places an episode on a calendar day: its scheduled time, else when it rang. */
const episodeTime = (r: WakeRecord): EpochMs | null => r.scheduledFor ?? r.firstRangAt ?? r.dismissedAt;

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

type DayVerdict = 'good' | 'bad' | 'open';

/**
 * A day is good when it has episodes, all dismissed, with no failed wake check. A day with a
 * missed/superseded episode or a failed check is bad. An `abandoned` episode TODAY may simply still
 * be in progress (snoozed, solving), so today is 'open' rather than bad in that case.
 */
function verdict(records: readonly WakeRecord[], isToday: boolean): DayVerdict {
  let open = false;
  for (const r of records) {
    if (r.wakeCheck === 'failed') return 'bad';
    if (r.outcome === 'dismissed') continue;
    if (r.outcome === 'abandoned' && isToday) open = true;
    else return 'bad';
  }
  return open ? 'open' : 'good';
}

export function computeStats(records: readonly WakeRecord[], now: EpochMs, zone: ZoneOffsetFn = localZone): WakeStats {
  const dismissed = records.filter((r) => r.outcome === 'dismissed');
  const rang = records.filter((r) => r.outcome !== 'missed');
  const missed = records.length - rang.length;

  const toUp = dismissed
    .filter((r) => r.scheduledFor !== null && r.dismissedAt !== null)
    .map((r) => ((r.dismissedAt as number) - (r.scheduledFor as number)) / 60_000);
  const confirmed = records.filter((r) => r.wakeCheck === 'confirmed').length;
  const failedChecks = records.filter((r) => r.wakeCheck === 'failed').length;

  // Group episodes by local calendar day.
  const byDay = new Map<string, WakeRecord[]>();
  for (const r of records) {
    const t = episodeTime(r);
    if (t === null) continue;
    const key = dateKey(localDateOf(t, zone));
    const list = byDay.get(key);
    if (list) list.push(r);
    else byDay.set(key, [r]);
  }

  const today = localDateOf(now, zone);
  const todayKey = dateKey(today);

  // Streaks: days with no alarm (weekends for a weekday alarm) neither count nor break a streak.
  const days = [...byDay.keys()].filter((k) => k <= todayKey).sort();
  let best = 0;
  let run = 0;
  for (const key of days) {
    const v = verdict(byDay.get(key) ?? [], key === todayKey);
    if (v === 'good') best = Math.max(best, ++run);
    else if (v === 'bad') run = 0;
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const key = days[i] as string;
    const v = verdict(byDay.get(key) ?? [], key === todayKey);
    if (v === 'good') current++;
    else if (v === 'bad') break;
  }

  const last14Days: DaySummary[] = [];
  for (let i = 13; i >= 0; i--) {
    const key = dateKey(addDays(today, -i));
    const list = byDay.get(key) ?? [];
    const dismissals = list.map((r) => r.dismissedAt).filter((t): t is number => t !== null && Number.isFinite(t));
    last14Days.push({
      date: key,
      dismissedAt: dismissals.length > 0 ? Math.min(...dismissals) : null,
      snoozes: list.reduce((sum, r) => sum + r.snoozeCount, 0),
      missed: list.filter((r) => r.outcome === 'missed').length,
    });
  }

  return {
    episodes: records.length,
    dismissed: dismissed.length,
    missed,
    avgSnoozes: mean(rang.map((r) => r.snoozeCount)),
    avgMissionTimeMs: mean(dismissed.map((r) => r.missionTimeMs)),
    avgMinutesToUp: mean(toUp),
    fallbackRate: rang.length === 0 ? 0 : rang.filter((r) => r.usedFallback || r.usedNativeFallback).length / rang.length,
    wakeCheckPassRate: confirmed + failedChecks === 0 ? null : confirmed / (confirmed + failedChecks),
    currentStreakDays: current,
    bestStreakDays: best,
    last14Days,
  };
}
