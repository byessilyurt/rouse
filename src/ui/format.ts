/**
 * Display formats (design.md §7.4). Pure; Intl only. Copy is English (en-GB date order, as in the spec).
 */
import type { EpochMs, MissionConfig, Settings, Weekday } from '../core/types';
import { MISSION_META } from '../core/defaults';

const LOCALE = 'en-GB';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 24 h unless the setting (or, for 'system', the device locale) says 12 h. */
export function resolveUse24h(clockFormat: Settings['clockFormat'], probeLocale?: string): boolean {
  if (clockFormat === '24h') return true;
  if (clockFormat === '12h') return false;
  try {
    const opts = new Intl.DateTimeFormat(probeLocale, { hour: 'numeric' }).resolvedOptions() as Intl.ResolvedDateTimeFormatOptions & {
      hourCycle?: string;
    };
    if (opts.hourCycle) return opts.hourCycle === 'h23' || opts.hourCycle === 'h24';
    return opts.hour12 === false;
  } catch {
    return true;
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `06:30` (24 h) or `{ time: '6:30', suffix: 'AM' }` (12 h). */
export function timeParts(hour: number, minute: number, use24h: boolean): { time: string; suffix: string } {
  if (use24h) return { time: `${pad2(hour)}:${pad2(minute)}`, suffix: '' };
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { time: `${h12}:${pad2(minute)}`, suffix: hour < 12 ? 'AM' : 'PM' };
}

export function formatTime(hour: number, minute: number, use24h: boolean): string {
  const p = timeParts(hour, minute, use24h);
  return p.suffix ? `${p.time} ${p.suffix}` : p.time;
}

export function formatInstantTime(at: EpochMs, use24h: boolean): string {
  const d = new Date(at);
  return formatTime(d.getHours(), d.getMinutes(), use24h);
}

/** Minutes rounded UP (an alarm 7 h 11 m 30 s away reads "7 h 12 m"). */
function splitUp(ms: number): { d: number; h: number; m: number } {
  const totalMin = Math.max(0, Math.ceil(ms / MIN));
  return { d: Math.floor(totalMin / 1440), h: Math.floor((totalMin % 1440) / 60), m: totalMin % 60 };
}

/** "in under a minute" · "in 45 m" · "in 7 h 12 m" · "in 1 d 3 h". */
export function formatIn(ms: number): string {
  if (ms < MIN) return 'in under a minute';
  const { d, h, m } = splitUp(ms);
  if (d > 0) return h > 0 ? `in ${d} d ${h} h` : `in ${d} d`;
  if (h > 0) return m > 0 ? `in ${h} h ${m} m` : `in ${h} h`;
  return `in ${m} m`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** Spoken form: "in 7 hours 12 minutes". */
export function formatInSpoken(ms: number): string {
  if (ms < MIN) return 'in under a minute';
  const { d, h, m } = splitUp(ms);
  if (d > 0) return h > 0 ? `in ${plural(d, 'day')} ${plural(h, 'hour')}` : `in ${plural(d, 'day')}`;
  if (h > 0) return m > 0 ? `in ${plural(h, 'hour')} ${plural(m, 'minute')}` : `in ${plural(h, 'hour')}`;
  return `in ${plural(m, 'minute')}`;
}

const weekdayShort = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const weekdayLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const fullDate = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });

function startOfDay(at: EpochMs): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar days from `now` to `at` in the local zone (0 = today). */
export function dayDiff(at: EpochMs, now: EpochMs): number {
  return Math.round((startOfDay(at) - startOfDay(now)) / DAY);
}

/** "Tue 06:30"; more than 6 days away: "Tue 22 Oct, 06:30". */
export function formatDayTime(at: EpochMs, now: EpochMs, use24h: boolean): string {
  const t = formatInstantTime(at, use24h);
  if (dayDiff(at, now) > 6) return `${shortDate.format(at).replace(/,/g, '')}, ${t}`;
  return `${weekdayShort.format(at)} ${t}`;
}

/** Spoken: "Tuesday 6:30" style. */
export function formatDayTimeSpoken(at: EpochMs, use24h: boolean): string {
  const d = new Date(at);
  const t = use24h ? `${d.getHours()}:${pad2(d.getMinutes())}` : formatTime(d.getHours(), d.getMinutes(), false);
  return `${weekdayLong.format(at)} ${t}`;
}

/** "Thursday 16 October". */
export function formatFullDate(at: EpochMs): string {
  return fullDate.format(at).replace(/,/g, '');
}

/** "16 Oct". */
export function formatDayMonth(at: EpochMs): string {
  return dayMonth.format(at);
}

/** "1 min 48 s", "45 s", "2 h 3 min". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return r > 0 ? `${m} min ${r} s` : `${m} min`;
}

/** "mm:ss" (or "h:mm:ss"). */
export function formatClockCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}

/** Week order starting at weekStartsOn (0 = Sunday). */
export function weekOrder(weekStartsOn: 0 | 1): Weekday[] {
  const all: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
  return weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : all;
}

// 2023-01-01 was a Sunday: index i → weekday i.
const REF_SUNDAY = Date.UTC(2023, 0, 1, 12);
const utcFmt = (style: 'narrow' | 'short' | 'long') => new Intl.DateTimeFormat(LOCALE, { weekday: style, timeZone: 'UTC' });
const narrowF = utcFmt('narrow');
const shortF = utcFmt('short');
const longF = utcFmt('long');
export function weekdayName(day: Weekday, style: 'narrow' | 'short' | 'long'): string {
  const at = REF_SUNDAY + day * DAY;
  return (style === 'narrow' ? narrowF : style === 'short' ? shortF : longF).format(at);
}

/** "Every day" / "Weekdays" / "Weekends" / "Once · tomorrow" / "Mon, Wed, Fri". */
export function repeatSummary(days: readonly Weekday[], weekStartsOn: 0 | 1, nextAt: EpochMs | null, now: EpochMs): string {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d as Weekday))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  if (set.size === 0) {
    if (nextAt == null) return 'Once';
    const diff = dayDiff(nextAt, now);
    const when = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : formatDayShort(nextAt);
    return `Once · ${when}`;
  }
  return weekOrder(weekStartsOn)
    .filter((d) => set.has(d))
    .map((d) => weekdayName(d, 'short'))
    .join(', ');
}

/** "Thu 16 Oct". */
export function formatDayShort(at: EpochMs): string {
  return shortDate.format(at).replace(/,/g, '');
}

const DIFFICULTY_NAMES = ['Very easy', 'Easy', 'Medium', 'Hard', 'Very hard'] as const;
export function mathDifficultyName(d: number): string {
  return DIFFICULTY_NAMES[Math.min(4, Math.max(0, d - 1))] ?? 'Medium';
}

const SENSITIVITY_NAMES = { low: 'Light', medium: 'Normal', high: 'Hard' } as const;

export function missionName(type: MissionConfig['type'] | 'random'): string {
  if (type === 'random') return 'Random';
  if (type === 'tap') return 'Tap';
  return MISSION_META[type].name;
}

/** Name used in prose ("QR code", not the tile's "QR / barcode"). */
export function missionProseName(type: MissionConfig['type']): string {
  return type === 'qr' ? 'QR code' : missionName(type);
}

/** One-line summary for MissionRow ("Medium · 3 problems", "Bathroom sink"). */
export function missionSummary(m: MissionConfig): string {
  switch (m.type) {
    case 'math':
      return `${mathDifficultyName(m.difficulty)} · ${plural(m.count, 'problem')}`;
    case 'memory':
      return `${m.gridSize}×${m.gridSize} grid · ${plural(m.rounds, 'round')}`;
    case 'typing':
      return m.phraseMode === 'custom' ? 'Your own phrase' : `${plural(m.phrases, 'phrase')}`;
    case 'shake':
      return `${plural(m.count, 'shake')} · ${SENSITIVITY_NAMES[m.sensitivity]}`;
    case 'qr':
      return m.expectedCode ? m.label || 'Code saved' : 'Code not set';
    case 'tap':
      return plural(m.targets, 'target');
    case 'steps':
      return plural(m.count, 'step');
    case 'squat':
      return plural(m.count, 'squat');
  }
}

/** Fallback mission description for the backup offer ("20 math problems, medium"). */
export function fallbackDescription(m: MissionConfig): string {
  switch (m.type) {
    case 'math':
      return `${m.count} math problems, ${mathDifficultyName(m.difficulty).toLowerCase()}`;
    case 'typing':
      return m.phraseMode === 'custom' ? 'typing your own phrase' : `typing ${m.phrases} long ${m.phrases === 1 ? 'phrase' : 'phrases'}`;
    case 'memory':
      return `${m.rounds} memory ${m.rounds === 1 ? 'round' : 'rounds'}`;
    case 'tap':
      return `tapping ${m.targets} targets`;
    default:
      return missionProseName(m.type);
  }
}
