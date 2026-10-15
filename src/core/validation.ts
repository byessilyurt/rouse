/**
 * Validation & normalisation. OWNER: core agent. API is part of the contract.
 * Used by the alarm editor (live errors), storage migration and backup import.
 */
import type {
  Alarm,
  AlarmDefaults,
  BundledSoundId,
  FallbackMissionConfig,
  MissionConfig,
  MissionType,
  Settings,
  SnoozeConfig,
  SoundRef,
  ValidationIssue,
  WakeUpCheckConfig,
  Weekday,
} from './types';
import {
  BUNDLED_SOUNDS,
  DEFAULT_SOUND,
  LIMITS,
  MAX_CUSTOM_PHRASE_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_MISSIONS,
  MISSION_TYPES,
  createAlarm,
  defaultMissionConfig,
  defaultSettings,
  isFallbackCapable,
} from './defaults';
import { normalizeCode } from '../missions/qr';

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

interface Range {
  readonly min: number;
  readonly max: number;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const BUNDLED_IDS = new Set<string>(BUNDLED_SOUNDS.map((s) => s.id));

function clampInt(value: number, range: Range): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

function checkInt(issues: ValidationIssue[], path: string, value: unknown, range: Range, what: string): void {
  if (!isFiniteNumber(value) || !Number.isInteger(value)) {
    issues.push({ path, message: `${what} must be a whole number.` });
  } else if (value < range.min || value > range.max) {
    issues.push({ path, message: `${what} must be between ${range.min} and ${range.max}.` });
  }
}

function checkBool(issues: ValidationIssue[], path: string, value: unknown): void {
  if (typeof value !== 'boolean') issues.push({ path, message: 'Must be on or off.' });
}

const missionName = (type: MissionType): string => type.charAt(0).toUpperCase() + type.slice(1);

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateSound(issues: ValidationIssue[], sound: unknown): void {
  if (!isRecord(sound)) {
    issues.push({ path: 'sound', message: 'Choose a sound.' });
  } else if (sound.kind === 'bundled') {
    if (typeof sound.id !== 'string' || !BUNDLED_IDS.has(sound.id)) issues.push({ path: 'sound.id', message: 'Unknown built-in sound.' });
  } else if (sound.kind === 'custom') {
    if (typeof sound.id !== 'string' || sound.id === '') issues.push({ path: 'sound.id', message: 'Custom sound is missing.' });
    if (typeof sound.name !== 'string') issues.push({ path: 'sound.name', message: 'Custom sound needs a name.' });
  } else {
    issues.push({ path: 'sound.kind', message: 'Unknown sound type.' });
  }
}

/** Issues for one mission config; `prefix` is e.g. "missions.1". Exported for settings/fallback checks. */
export function validateMission(mission: MissionConfig, prefix: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = (field: string): string => `${prefix}.${field}`;
  if (!isRecord(mission) || !MISSION_TYPES.includes((mission as { type: MissionType }).type)) {
    return [{ path: `${prefix}.type`, message: 'Unknown mission type.' }];
  }
  switch (mission.type) {
    case 'math':
      checkInt(issues, p('difficulty'), mission.difficulty, LIMITS.math.difficulty, 'Difficulty');
      checkInt(issues, p('count'), mission.count, LIMITS.math.count, 'Number of problems');
      break;
    case 'memory':
      checkInt(issues, p('gridSize'), mission.gridSize, LIMITS.memory.gridSize, 'Grid size');
      checkInt(issues, p('rounds'), mission.rounds, LIMITS.memory.rounds, 'Rounds');
      break;
    case 'typing': {
      if (mission.phraseMode !== 'random' && mission.phraseMode !== 'custom') {
        issues.push({ path: p('phraseMode'), message: 'Choose built-in or your own phrase.' });
      }
      if (typeof mission.customPhrase !== 'string') {
        issues.push({ path: p('customPhrase'), message: 'Phrase must be text.' });
      } else if (mission.phraseMode === 'custom') {
        const len = mission.customPhrase.trim().length;
        if (len === 0) issues.push({ path: p('customPhrase'), message: 'Type the phrase you want to copy each morning.' });
        else if (len > MAX_CUSTOM_PHRASE_LENGTH) {
          issues.push({ path: p('customPhrase'), message: `Phrase can be at most ${MAX_CUSTOM_PHRASE_LENGTH} characters.` });
        }
      }
      checkBool(issues, p('strictCase'), mission.strictCase);
      checkInt(issues, p('phrases'), mission.phrases, LIMITS.typing.phrases, 'Number of phrases');
      break;
    }
    case 'shake':
      checkInt(issues, p('count'), mission.count, LIMITS.shake.count, 'Shakes');
      if (!['low', 'medium', 'high'].includes(mission.sensitivity)) issues.push({ path: p('sensitivity'), message: 'Choose a strength.' });
      break;
    case 'qr':
      if (typeof mission.expectedCode !== 'string' || normalizeCode(mission.expectedCode) === '') {
        issues.push({ path: p('expectedCode'), message: 'Scan the code you want to use before saving.' });
      }
      if (typeof mission.label !== 'string') issues.push({ path: p('label'), message: 'Location must be text.' });
      break;
    case 'tap':
      checkInt(issues, p('targets'), mission.targets, LIMITS.tap.targets, 'Targets');
      break;
    case 'steps':
      checkInt(issues, p('count'), mission.count, LIMITS.steps.count, 'Steps');
      break;
    case 'squat':
      checkInt(issues, p('count'), mission.count, LIMITS.squat.count, 'Squats');
      break;
  }
  return issues;
}

/** Problems that block saving (QR without code, > MAX_MISSIONS, out-of-range numbers, bad days…). [] = valid. */
export function validateAlarm(alarm: Alarm): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(alarm)) return [{ path: '', message: 'Not an alarm.' }];

  if (typeof alarm.id !== 'string' || alarm.id === '') issues.push({ path: 'id', message: 'Alarm id is missing.' });
  checkInt(issues, 'hour', alarm.hour, { min: 0, max: 23 }, 'Hour');
  checkInt(issues, 'minute', alarm.minute, { min: 0, max: 59 }, 'Minute');

  if (!Array.isArray(alarm.days)) {
    issues.push({ path: 'days', message: 'Repeat days are missing.' });
  } else {
    alarm.days.forEach((d, i) => {
      if (!Number.isInteger(d) || d < 0 || d > 6) issues.push({ path: `days.${i}`, message: 'Unknown day of the week.' });
    });
    for (let i = 1; i < alarm.days.length; i++) {
      if ((alarm.days[i] as number) <= (alarm.days[i - 1] as number)) {
        issues.push({ path: 'days', message: 'Repeat days must be sorted and listed once each.' });
        break;
      }
    }
  }

  checkBool(issues, 'enabled', alarm.enabled);
  if (typeof alarm.label !== 'string') issues.push({ path: 'label', message: 'Label must be text.' });
  else if (alarm.label.length > MAX_LABEL_LENGTH) {
    issues.push({ path: 'label', message: `Label can be at most ${MAX_LABEL_LENGTH} characters.` });
  }
  if (alarm.skipUntil !== null && !isFiniteNumber(alarm.skipUntil)) issues.push({ path: 'skipUntil', message: 'Invalid skip marker.' });
  checkBool(issues, 'deleteAfterRing', alarm.deleteAfterRing);
  validateSound(issues, alarm.sound);
  checkInt(issues, 'volume', alarm.volume, LIMITS.volume, 'Volume');
  checkInt(issues, 'volumeRampSec', alarm.volumeRampSec, LIMITS.volumeRampSec, 'Volume ramp');
  checkBool(issues, 'vibrate', alarm.vibrate);

  if (!isRecord(alarm.snooze)) {
    issues.push({ path: 'snooze', message: 'Snooze settings are missing.' });
  } else {
    checkBool(issues, 'snooze.enabled', alarm.snooze.enabled);
    checkInt(issues, 'snooze.intervalMin', alarm.snooze.intervalMin, LIMITS.snoozeIntervalMin, 'Snooze length');
    checkInt(issues, 'snooze.maxCount', alarm.snooze.maxCount, LIMITS.snoozeMaxCount, 'Snoozes allowed');
    checkBool(issues, 'snooze.requireMission', alarm.snooze.requireMission);
  }

  if (!Array.isArray(alarm.missions)) {
    issues.push({ path: 'missions', message: 'Missions are missing.' });
  } else {
    if (alarm.missions.length > MAX_MISSIONS) {
      issues.push({ path: 'missions', message: `At most ${MAX_MISSIONS} missions per alarm.` });
    }
    alarm.missions.forEach((m, i) => issues.push(...validateMission(m, `missions.${i}`)));
  }
  checkBool(issues, 'randomMission', alarm.randomMission);

  if (!isRecord(alarm.wakeUpCheck)) {
    issues.push({ path: 'wakeUpCheck', message: 'Wake-up check settings are missing.' });
  } else {
    checkBool(issues, 'wakeUpCheck.enabled', alarm.wakeUpCheck.enabled);
    checkInt(issues, 'wakeUpCheck.delayMin', alarm.wakeUpCheck.delayMin, LIMITS.wakeCheckDelayMin, 'Wake-up check delay');
    checkInt(issues, 'wakeUpCheck.windowMin', alarm.wakeUpCheck.windowMin, LIMITS.wakeCheckWindowMin, 'Time to answer');
  }
  if (!isFiniteNumber(alarm.createdAt)) issues.push({ path: 'createdAt', message: 'Invalid creation time.' });
  if (!isFiniteNumber(alarm.updatedAt)) issues.push({ path: 'updatedAt', message: 'Invalid update time.' });
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────────────

function normalizeMission(m: MissionConfig): MissionConfig {
  switch (m.type) {
    case 'math':
      return { ...m, difficulty: clampInt(m.difficulty, LIMITS.math.difficulty) as 1 | 2 | 3 | 4 | 5, count: clampInt(m.count, LIMITS.math.count) };
    case 'memory':
      return { ...m, gridSize: clampInt(m.gridSize, LIMITS.memory.gridSize) as 3 | 4 | 5, rounds: clampInt(m.rounds, LIMITS.memory.rounds) };
    case 'typing':
      // The custom phrase is never cut silently: an over-long phrase is a validation error instead.
      return { ...m, customPhrase: typeof m.customPhrase === 'string' ? m.customPhrase : '', phrases: clampInt(m.phrases, LIMITS.typing.phrases) };
    case 'shake':
      return { ...m, count: clampInt(m.count, LIMITS.shake.count) };
    case 'qr':
      return {
        ...m,
        expectedCode: typeof m.expectedCode === 'string' ? normalizeCode(m.expectedCode) : '',
        label: typeof m.label === 'string' ? m.label.slice(0, MAX_LABEL_LENGTH) : '',
      };
    case 'tap':
      return { ...m, targets: clampInt(m.targets, LIMITS.tap.targets) };
    case 'steps':
      return { ...m, count: clampInt(m.count, LIMITS.steps.count) };
    case 'squat':
      return { ...m, count: clampInt(m.count, LIMITS.squat.count) };
    default:
      return m;
  }
}

function normalizeDays(days: unknown): Weekday[] {
  if (!Array.isArray(days)) return [];
  const set = new Set<Weekday>();
  for (const d of days) if (Number.isInteger(d) && d >= 0 && d <= 6) set.add(d as Weekday);
  return [...set].sort((a, b) => a - b);
}

/** Clamp numbers into LIMITS, sort+dedupe days, trim label to MAX_LABEL_LENGTH. Never throws. */
export function normalizeAlarm(alarm: Alarm): Alarm {
  const snooze: SnoozeConfig = {
    ...alarm.snooze,
    intervalMin: clampInt(alarm.snooze?.intervalMin, LIMITS.snoozeIntervalMin),
    maxCount: clampInt(alarm.snooze?.maxCount, LIMITS.snoozeMaxCount),
  };
  const wakeUpCheck: WakeUpCheckConfig = {
    ...alarm.wakeUpCheck,
    delayMin: clampInt(alarm.wakeUpCheck?.delayMin, LIMITS.wakeCheckDelayMin),
    windowMin: clampInt(alarm.wakeUpCheck?.windowMin, LIMITS.wakeCheckWindowMin),
  };
  return {
    ...alarm,
    hour: clampInt(alarm.hour, { min: 0, max: 23 }),
    minute: clampInt(alarm.minute, { min: 0, max: 59 }),
    days: normalizeDays(alarm.days),
    label: typeof alarm.label === 'string' ? alarm.label.slice(0, MAX_LABEL_LENGTH) : '',
    volume: clampInt(alarm.volume, LIMITS.volume),
    volumeRampSec: clampInt(alarm.volumeRampSec, LIMITS.volumeRampSec),
    snooze,
    missions: Array.isArray(alarm.missions) ? alarm.missions.map((m) => (isRecord(m) ? normalizeMission(m) : m)) : [],
    wakeUpCheck,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing untrusted input
// ─────────────────────────────────────────────────────────────────────────────

/** `raw` if it has the right primitive type, else the fallback (and an issue when the field was present). */
function field<T>(issues: ValidationIssue[] | null, path: string, raw: unknown, fallback: T, ok: (v: unknown) => boolean): T {
  if (raw === undefined) return fallback;
  if (ok(raw)) return raw as T;
  issues?.push({ path, message: 'Invalid value.' });
  return fallback;
}

const isBool = (v: unknown): boolean => typeof v === 'boolean';
const isStr = (v: unknown): boolean => typeof v === 'string';

/** Lenient sound parse: unknown bundled ids (e.g. from a newer version) become DEFAULT_SOUND. */
export function parseSoundRef(raw: unknown, fallback: SoundRef = DEFAULT_SOUND): SoundRef {
  if (!isRecord(raw)) return { ...fallback };
  if (raw.kind === 'bundled' && typeof raw.id === 'string' && BUNDLED_IDS.has(raw.id)) {
    return { kind: 'bundled', id: raw.id as BundledSoundId };
  }
  if (raw.kind === 'custom' && typeof raw.id === 'string' && raw.id !== '') {
    return { kind: 'custom', id: raw.id, name: typeof raw.name === 'string' ? raw.name : raw.id };
  }
  return { ...DEFAULT_SOUND };
}

/** Parse one mission config: known type required; other fields default when missing or of the wrong type. */
export function parseMission(raw: unknown): MissionConfig | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || !MISSION_TYPES.includes(raw.type as MissionType)) return null;
  const base = defaultMissionConfig(raw.type as MissionType) as unknown as Rec;
  const out: Rec = { ...base };
  for (const [key, def] of Object.entries(base)) {
    const v = raw[key];
    if (v !== undefined && typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) out[key] = v;
  }
  return normalizeMission(out as unknown as MissionConfig);
}

function parseSnooze(raw: unknown, fallback: SnoozeConfig, issues: ValidationIssue[] | null): SnoozeConfig {
  if (!isRecord(raw)) return { ...fallback };
  return {
    enabled: field(issues, 'snooze.enabled', raw.enabled, fallback.enabled, isBool),
    intervalMin: field(issues, 'snooze.intervalMin', raw.intervalMin, fallback.intervalMin, isFiniteNumber),
    maxCount: field(issues, 'snooze.maxCount', raw.maxCount, fallback.maxCount, isFiniteNumber),
    requireMission: field(issues, 'snooze.requireMission', raw.requireMission, fallback.requireMission, isBool),
  };
}

function parseWakeUpCheck(raw: unknown, fallback: WakeUpCheckConfig, issues: ValidationIssue[] | null): WakeUpCheckConfig {
  if (!isRecord(raw)) return { ...fallback };
  return {
    enabled: field(issues, 'wakeUpCheck.enabled', raw.enabled, fallback.enabled, isBool),
    delayMin: field(issues, 'wakeUpCheck.delayMin', raw.delayMin, fallback.delayMin, isFiniteNumber),
    windowMin: field(issues, 'wakeUpCheck.windowMin', raw.windowMin, fallback.windowMin, isFiniteNumber),
  };
}

/** Parse untrusted JSON-ish input (storage, backup) into an Alarm; missing optional fields get defaults. */
export function parseAlarm(raw: unknown): { ok: true; alarm: Alarm } | { ok: false; issues: ValidationIssue[] } {
  if (!isRecord(raw)) return { ok: false, issues: [{ path: '', message: 'Not an alarm.' }] };
  const issues: ValidationIssue[] = [];
  if (typeof raw.id !== 'string' || raw.id === '') issues.push({ path: 'id', message: 'Alarm id is missing.' });
  if (!isFiniteNumber(raw.hour)) issues.push({ path: 'hour', message: 'Alarm time is missing.' });
  if (!isFiniteNumber(raw.minute)) issues.push({ path: 'minute', message: 'Alarm time is missing.' });
  if (issues.length > 0) return { ok: false, issues };

  const createdAt = isFiniteNumber(raw.createdAt) ? raw.createdAt : 0;
  const base = createAlarm({ id: raw.id as string, now: createdAt, hour: raw.hour as number, minute: raw.minute as number });

  const missions: MissionConfig[] = [];
  if (raw.missions !== undefined) {
    if (!Array.isArray(raw.missions)) issues.push({ path: 'missions', message: 'Invalid value.' });
    else
      raw.missions.forEach((m, i) => {
        const parsed = parseMission(m);
        if (parsed) missions.push(parsed);
        else issues.push({ path: `missions.${i}.type`, message: 'Unknown mission type.' });
      });
  }

  const alarm: Alarm = {
    ...base,
    days: raw.days === undefined ? base.days : normalizeDays(raw.days),
    enabled: field(issues, 'enabled', raw.enabled, base.enabled, isBool),
    label: field(issues, 'label', raw.label, base.label, isStr),
    skipUntil: field(issues, 'skipUntil', raw.skipUntil ?? null, null as number | null, (v) => v === null || isFiniteNumber(v)),
    deleteAfterRing: field(issues, 'deleteAfterRing', raw.deleteAfterRing, base.deleteAfterRing, isBool),
    sound: parseSoundRef(raw.sound, base.sound),
    volume: field(issues, 'volume', raw.volume, base.volume, isFiniteNumber),
    volumeRampSec: field(issues, 'volumeRampSec', raw.volumeRampSec, base.volumeRampSec, isFiniteNumber),
    vibrate: field(issues, 'vibrate', raw.vibrate, base.vibrate, isBool),
    snooze: parseSnooze(raw.snooze, base.snooze, issues),
    missions: raw.missions === undefined ? base.missions : missions,
    randomMission: field(issues, 'randomMission', raw.randomMission, base.randomMission, isBool),
    wakeUpCheck: parseWakeUpCheck(raw.wakeUpCheck, base.wakeUpCheck, issues),
    createdAt,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : createdAt,
  };
  if (raw.days !== undefined && !Array.isArray(raw.days)) issues.push({ path: 'days', message: 'Invalid value.' });
  if (issues.length > 0) return { ok: false, issues };

  const normalized = normalizeAlarm(alarm);
  const remaining = validateAlarm(normalized);
  return remaining.length > 0 ? { ok: false, issues: remaining } : { ok: true, alarm: normalized };
}

function parseFallbackMission(raw: unknown, fallback: FallbackMissionConfig): FallbackMissionConfig {
  const m = parseMission(raw);
  if (!m || !isFallbackCapable(m) || validateMission(m, 'fallback.mission').length > 0) return fallback;
  return m;
}

function parseAlarmDefaults(raw: unknown, fallback: AlarmDefaults): AlarmDefaults {
  if (!isRecord(raw)) return fallback;
  const missions = Array.isArray(raw.missions)
    ? raw.missions
        .map(parseMission)
        .filter((m): m is MissionConfig => m !== null && validateMission(m, 'm').length === 0)
        .slice(0, MAX_MISSIONS)
    : fallback.missions;
  return {
    sound: parseSoundRef(raw.sound, fallback.sound),
    volume: clampInt(field(null, '', raw.volume, fallback.volume, isFiniteNumber), LIMITS.volume),
    volumeRampSec: clampInt(field(null, '', raw.volumeRampSec, fallback.volumeRampSec, isFiniteNumber), LIMITS.volumeRampSec),
    vibrate: field(null, '', raw.vibrate, fallback.vibrate, isBool),
    snooze: (() => {
      const s = parseSnooze(raw.snooze, fallback.snooze, null);
      return { ...s, intervalMin: clampInt(s.intervalMin, LIMITS.snoozeIntervalMin), maxCount: clampInt(s.maxCount, LIMITS.snoozeMaxCount) };
    })(),
    missions,
    randomMission: field(null, '', raw.randomMission, fallback.randomMission, isBool),
    wakeUpCheck: (() => {
      const w = parseWakeUpCheck(raw.wakeUpCheck, fallback.wakeUpCheck, null);
      return { ...w, delayMin: clampInt(w.delayMin, LIMITS.wakeCheckDelayMin), windowMin: clampInt(w.windowMin, LIMITS.wakeCheckWindowMin) };
    })(),
  };
}

/** Parse untrusted settings; every missing/invalid field falls back to defaultSettings(). Never fails. */
export function parseSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isRecord(raw)) return d;
  const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const num = (v: unknown, fallback: number, range: Range): number => (isFiniteNumber(v) ? clampInt(v, range) : fallback);
  const fb = isRecord(raw.fallback) ? raw.fallback : {};
  const bt = isRecord(raw.bedtimeReminder) ? raw.bedtimeReminder : {};
  return {
    theme: oneOf(raw.theme, ['system', 'light', 'dark'] as const, d.theme),
    clockFormat: oneOf(raw.clockFormat, ['system', '12h', '24h'] as const, d.clockFormat),
    weekStartsOn: oneOf(raw.weekStartsOn, [0, 1] as const, d.weekStartsOn),
    alarmDefaults: parseAlarmDefaults(raw.alarmDefaults, d.alarmDefaults),
    fallback: {
      afterFailures: num(fb.afterFailures, d.fallback.afterFailures, LIMITS.fallbackAfterFailures),
      afterMinutes: num(fb.afterMinutes, d.fallback.afterMinutes, LIMITS.fallbackAfterMinutes),
      mission: parseFallbackMission(fb.mission, d.fallback.mission),
    },
    silenceWhileSolvingSec: num(raw.silenceWhileSolvingSec, d.silenceWhileSolvingSec, LIMITS.silenceWhileSolvingSec),
    bedtimeReminder: {
      enabled: typeof bt.enabled === 'boolean' ? bt.enabled : d.bedtimeReminder.enabled,
      sleepGoalMin: num(bt.sleepGoalMin, d.bedtimeReminder.sleepGoalMin, LIMITS.sleepGoalMin),
    },
    napMinutes: num(raw.napMinutes, d.napMinutes, LIMITS.napMinutes),
    onboardingDone: typeof raw.onboardingDone === 'boolean' ? raw.onboardingDone : d.onboardingDone,
  };
}
