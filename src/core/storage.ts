/**
 * Persistence over localStorage with versioned migration + backup export/import.
 * OWNER: core agent. API is part of the contract.
 */
import type {
  Alarm,
  AlarmId,
  BackupFile,
  EpochMs,
  ImportMode,
  ImportResult,
  PersistedState,
  RingSession,
  Settings,
  SoundRef,
  StorageMeta,
  WakeCheckOutcome,
  WakeOutcome,
  WakeRecord,
} from './types';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  DEFAULT_SOUND,
  MAX_ALARMS,
  MAX_WAKE_RECORDS,
  RING_PROGRESS_KEY_PREFIX,
  STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
  defaultSettings,
} from './defaults';
import { parseAlarm, parseSettings } from './validation';

/** Subset of the Web Storage API (window.localStorage, or an in-memory fake in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Raw state that could not be read is copied to `${CORRUPT_KEY_PREFIX}${timestamp}` before starting fresh. */
export const CORRUPT_KEY_PREFIX = `${STORAGE_KEY}.corrupt.`;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function freshState(now: EpochMs): PersistedState {
  return {
    schemaVersion: 1,
    alarms: [],
    settings: defaultSettings(),
    wakeRecords: [],
    meta: { lastAppliedLogSeq: 0, createdAt: now },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Wake records
// ─────────────────────────────────────────────────────────────────────────────

const WAKE_OUTCOMES: readonly WakeOutcome[] = ['dismissed', 'missed', 'superseded', 'abandoned'];
const WAKE_CHECK_OUTCOMES: readonly WakeCheckOutcome[] = ['off', 'pending', 'confirmed', 'failed'];

/** Lenient wake-record parse; null if the record has no usable id/alarmId. */
export function parseWakeRecord(raw: unknown): WakeRecord | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '' || typeof raw.alarmId !== 'string') return null;
  const time = (v: unknown): EpochMs | null => (isFiniteNumber(v) ? v : null);
  const count = (v: unknown): number => (isFiniteNumber(v) && v >= 0 ? Math.round(v) : 0);
  return {
    id: raw.id,
    alarmId: raw.alarmId,
    label: typeof raw.label === 'string' ? raw.label : '',
    scheduledFor: time(raw.scheduledFor),
    firstRangAt: time(raw.firstRangAt),
    dismissedAt: time(raw.dismissedAt),
    outcome: WAKE_OUTCOMES.includes(raw.outcome as WakeOutcome) ? (raw.outcome as WakeOutcome) : 'abandoned',
    snoozeCount: count(raw.snoozeCount),
    missionsCompleted: count(raw.missionsCompleted),
    missionTimeMs: count(raw.missionTimeMs),
    failedAttempts: count(raw.failedAttempts),
    usedFallback: raw.usedFallback === true,
    usedNativeFallback: raw.usedNativeFallback === true,
    wakeCheck: WAKE_CHECK_OUTCOMES.includes(raw.wakeCheck as WakeCheckOutcome) ? (raw.wakeCheck as WakeCheckOutcome) : 'off',
    wakeCheckReRings: count(raw.wakeCheckReRings),
  };
}

/** Chronological key used to decide which records are "oldest". */
const recordTime = (r: WakeRecord): number => r.scheduledFor ?? r.firstRangAt ?? r.dismissedAt ?? 0;

/** Oldest first; drops the oldest beyond MAX_WAKE_RECORDS. Stable for equal times. */
function trimRecords(records: WakeRecord[]): WakeRecord[] {
  const sorted = records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => recordTime(a.r) - recordTime(b.r) || a.i - b.i)
    .map((x) => x.r);
  return sorted.length > MAX_WAKE_RECORDS ? sorted.slice(sorted.length - MAX_WAKE_RECORDS) : sorted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration
// ─────────────────────────────────────────────────────────────────────────────

type RawKind = 'empty' | 'v0' | 'v1' | 'unsupported';

/**
 * v0 = the pre-versioned shape: an object without `schemaVersion` (or `schemaVersion: 0`) holding any
 * of alarms/settings/wakeRecords/meta, or a bare array of alarms. Anything else that is not v1
 * (newer versions, non-objects) is unsupported.
 */
function classify(raw: unknown): RawKind {
  if (raw === null || raw === undefined) return 'empty';
  if (Array.isArray(raw)) return 'v0';
  if (!isRecord(raw)) return 'unsupported';
  if (raw.schemaVersion === undefined || raw.schemaVersion === 0) return 'v0';
  if (raw.schemaVersion === STORAGE_SCHEMA_VERSION) return 'v1';
  return 'unsupported';
}

function parseAlarmList(raw: unknown): Alarm[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Alarm[] = [];
  for (const item of raw) {
    const parsed = parseAlarm(item);
    if (!parsed.ok || seen.has(parsed.alarm.id)) continue;
    seen.add(parsed.alarm.id);
    out.push(parsed.alarm);
  }
  return out.slice(0, MAX_ALARMS);
}

function parseRecordList(raw: unknown): WakeRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, WakeRecord>();
  for (const item of raw) {
    const r = parseWakeRecord(item);
    if (r) byId.set(r.id, r);
  }
  return trimRecords([...byId.values()]);
}

/** Bring any previously stored shape (or null) up to the current PersistedState. Pure, never throws. */
export function migrateState(raw: unknown, now: EpochMs): PersistedState {
  try {
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        return freshState(now);
      }
    }
    const kind = classify(raw);
    if (kind === 'empty' || kind === 'unsupported') return freshState(now);
    // v0 → v1: same field names, just no version and possibly a bare alarm array. Both shapes are
    // re-parsed leniently so a hand-edited or partially written state still loads.
    const obj: Rec = Array.isArray(raw) ? { alarms: raw } : (raw as Rec);
    const meta = isRecord(obj.meta) ? obj.meta : {};
    return {
      schemaVersion: 1,
      alarms: parseAlarmList(obj.alarms),
      settings: parseSettings(obj.settings),
      wakeRecords: parseRecordList(obj.wakeRecords),
      meta: {
        lastAppliedLogSeq: isFiniteNumber(meta.lastAppliedLogSeq) && meta.lastAppliedLogSeq >= 0 ? meta.lastAppliedLogSeq : 0,
        createdAt: isFiniteNumber(meta.createdAt) ? meta.createdAt : now,
      },
    };
  } catch {
    return freshState(now);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup
// ─────────────────────────────────────────────────────────────────────────────

const describeAlarm = (raw: unknown, index: number): string => {
  if (isRecord(raw) && isFiniteNumber(raw.hour) && isFiniteNumber(raw.minute)) {
    const time = `${String(raw.hour).padStart(2, '0')}:${String(raw.minute).padStart(2, '0')}`;
    const label = typeof raw.label === 'string' && raw.label !== '' ? ` "${raw.label}"` : '';
    return `Alarm ${index + 1} (${time}${label})`;
  }
  return `Alarm ${index + 1}`;
};

/** Validate a backup file's text. Rejects other formats and versions newer than BACKUP_VERSION. */
export function parseBackup(json: string): { ok: true; backup: BackupFile; warnings: string[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) return { ok: false, error: 'This is not a Rouse backup file.' };
  if (!isFiniteNumber(raw.version) || raw.version < 1) return { ok: false, error: 'This backup has an unknown version.' };
  if (raw.version > BACKUP_VERSION) {
    return { ok: false, error: 'This backup was made by a newer version of Rouse. Update the app and try again.' };
  }
  if (!Array.isArray(raw.alarms)) return { ok: false, error: 'This backup has no alarm list.' };

  const warnings: string[] = [];
  const alarms: Alarm[] = [];
  const ids = new Set<string>();
  raw.alarms.forEach((item, i) => {
    const parsed = parseAlarm(item);
    if (!parsed.ok) {
      const first = parsed.issues[0];
      warnings.push(`${describeAlarm(item, i)} was skipped: ${first ? first.message : 'invalid'}`);
    } else if (ids.has(parsed.alarm.id)) {
      warnings.push(`${describeAlarm(item, i)} was skipped: it appears twice in the file.`);
    } else if (alarms.length >= MAX_ALARMS) {
      warnings.push(`${describeAlarm(item, i)} was skipped: at most ${MAX_ALARMS} alarms.`);
    } else {
      ids.add(parsed.alarm.id);
      alarms.push(parsed.alarm);
    }
  });

  if (!isRecord(raw.settings)) warnings.push('The backup has no settings; defaults are used.');
  let wakeRecords: WakeRecord[] = [];
  if (raw.wakeRecords !== undefined) {
    if (!Array.isArray(raw.wakeRecords)) {
      warnings.push('Statistics in the backup could not be read.');
    } else {
      wakeRecords = parseRecordList(raw.wakeRecords);
      const skipped = raw.wakeRecords.length - wakeRecords.length;
      if (skipped > 0) warnings.push(`${skipped} statistics ${skipped === 1 ? 'entry was' : 'entries were'} skipped.`);
    }
  }

  return {
    ok: true,
    warnings,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: isFiniteNumber(raw.exportedAt) ? raw.exportedAt : 0,
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : 'unknown',
      alarms,
      settings: parseSettings(raw.settings),
      wakeRecords,
    },
  };
}

/** UUID v4 via Web Crypto (core purity allows crypto). */
function newUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

/** Synchronous repository. Every mutation writes through to storage immediately. */
export class Repository {
  private state: PersistedState | null = null;
  private warning: string | null = null;

  constructor(
    private readonly storage: StorageLike,
    private readonly now: () => EpochMs,
  ) {}

  /**
   * Non-null when the stored state could not be loaded (corrupt JSON, or written by a newer
   * version) and the app started fresh. The raw text was kept under CORRUPT_KEY_PREFIX + timestamp.
   */
  getLoadWarning(): string | null {
    this.load();
    return this.warning;
  }

  private load(): PersistedState {
    if (this.state) return this.state;
    const now = this.now();
    const text = this.safeGet(STORAGE_KEY);
    if (text === null) {
      this.state = freshState(now);
      this.write();
      return this.state;
    }
    let raw: unknown;
    let readable = true;
    try {
      raw = JSON.parse(text);
    } catch {
      readable = false;
    }
    const kind = readable ? classify(raw) : 'unsupported';
    if (kind === 'unsupported' || kind === 'empty') {
      this.backupCorrupt(text, now, readable ? 'newer or unknown version' : 'unreadable');
      this.state = freshState(now);
    } else {
      this.state = migrateState(raw, now);
    }
    this.write();
    return this.state;
  }

  private backupCorrupt(text: string, now: EpochMs, why: string): void {
    const key = `${CORRUPT_KEY_PREFIX}${now}`;
    try {
      this.storage.setItem(key, text);
      this.warning = `Saved data could not be loaded (${why}), so Rouse started fresh. A copy was kept as ${key}.`;
    } catch {
      this.warning = `Saved data could not be loaded (${why}), so Rouse started fresh.`;
    }
  }

  private safeGet(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(): void {
    if (this.state) this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private update(patch: Partial<PersistedState>): void {
    this.state = { ...this.load(), ...patch };
    this.write();
  }

  getState(): Readonly<PersistedState> {
    return this.load();
  }
  getAlarms(): readonly Alarm[] {
    return this.load().alarms;
  }
  getAlarm(id: AlarmId): Alarm | undefined {
    return this.load().alarms.find((a) => a.id === id);
  }
  /** Insert or replace by id; sets updatedAt. */
  upsertAlarm(alarm: Alarm): void {
    const stored: Alarm = { ...clone(alarm), updatedAt: this.now() };
    const alarms = this.load().alarms;
    const i = alarms.findIndex((a) => a.id === alarm.id);
    this.update({ alarms: i === -1 ? [...alarms, stored] : alarms.map((a, j) => (j === i ? stored : a)) });
  }
  deleteAlarm(id: AlarmId): void {
    const alarms = this.load().alarms;
    if (!alarms.some((a) => a.id === id)) return;
    this.update({ alarms: alarms.filter((a) => a.id !== id) });
  }
  getSettings(): Settings {
    return this.load().settings;
  }
  saveSettings(settings: Settings): void {
    this.update({ settings: clone(settings) });
  }
  getWakeRecords(): readonly WakeRecord[] {
    return this.load().wakeRecords;
  }
  /** Insert or merge by id; trims to MAX_WAKE_RECORDS (oldest first). */
  upsertWakeRecord(record: WakeRecord): void {
    const records = this.load().wakeRecords;
    const i = records.findIndex((r) => r.id === record.id);
    const next = i === -1 ? [...records, clone(record)] : records.map((r, j) => (j === i ? { ...r, ...clone(record) } : r));
    this.update({ wakeRecords: trimRecords(next) });
  }
  /** Remove every wake record ("Clear statistics"). */
  clearWakeRecords(): void {
    this.update({ wakeRecords: [] });
  }
  getMeta(): StorageMeta {
    return this.load().meta;
  }
  setMeta(patch: Partial<StorageMeta>): void {
    this.update({ meta: { ...this.load().meta, ...patch } });
  }

  loadRingProgress(sessionId: string): RingSession | null {
    const text = this.safeGet(RING_PROGRESS_KEY_PREFIX + sessionId);
    if (text === null) return null;
    try {
      const raw = JSON.parse(text) as unknown;
      if (
        !isRecord(raw) ||
        raw.sessionId !== sessionId ||
        !Array.isArray(raw.plan) ||
        !isFiniteNumber(raw.missionIndex) ||
        !isRecord(raw.alarm)
      ) {
        return null;
      }
      return raw as unknown as RingSession;
    } catch {
      return null;
    }
  }
  saveRingProgress(session: RingSession): void {
    this.storage.setItem(RING_PROGRESS_KEY_PREFIX + session.sessionId, JSON.stringify(session));
  }
  clearRingProgress(sessionId: string): void {
    this.storage.removeItem(RING_PROGRESS_KEY_PREFIX + sessionId);
  }

  exportBackup(appVersion: string): BackupFile {
    const s = this.load();
    return clone({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: this.now(),
      appVersion,
      alarms: s.alarms,
      settings: s.settings,
      wakeRecords: s.wakeRecords,
    });
  }

  /**
   * Import a backup. 'replace' swaps alarms+settings+records; 'merge' adds alarms with new ids
   * (keeps existing), keeps current settings, merges records by id. Custom sounds not in
   * `knownCustomSoundIds` are replaced by DEFAULT_SOUND with a warning.
   */
  importBackup(json: string, mode: ImportMode, knownCustomSoundIds: readonly string[]): ImportResult {
    const parsed = parseBackup(json);
    if (!parsed.ok) return parsed;
    const { backup } = parsed;
    const warnings = [...parsed.warnings];
    const known = new Set(knownCustomSoundIds);
    const warnedSounds = new Set<string>();
    const checkSound = (sound: SoundRef): SoundRef => {
      if (sound.kind !== 'custom' || known.has(sound.id)) return sound;
      if (!warnedSounds.has(sound.id)) {
        warnedSounds.add(sound.id);
        warnings.push(`Custom sound "${sound.name}" isn't on this device, so the default sound is used instead.`);
      }
      return { ...DEFAULT_SOUND };
    };
    const now = this.now();
    const incoming = backup.alarms.map((a) => ({ ...a, sound: checkSound(a.sound), updatedAt: now }));
    const current = this.load();

    if (mode === 'replace') {
      const settings = backup.settings;
      settings.alarmDefaults = { ...settings.alarmDefaults, sound: checkSound(settings.alarmDefaults.sound) };
      this.update({ alarms: incoming, settings, wakeRecords: trimRecords(backup.wakeRecords) });
      return { ok: true, alarmsImported: incoming.length, recordsImported: backup.wakeRecords.length, warnings };
    }

    const room = Math.max(0, MAX_ALARMS - current.alarms.length);
    if (incoming.length > room) {
      warnings.push(`Only ${room} of ${incoming.length} alarms were added: at most ${MAX_ALARMS} alarms.`);
    }
    const added = incoming.slice(0, room).map((a) => ({ ...a, id: newUuid() }));
    const existingIds = new Set(current.wakeRecords.map((r) => r.id));
    const newRecords = backup.wakeRecords.filter((r) => !existingIds.has(r.id));
    this.update({
      alarms: [...current.alarms, ...added],
      wakeRecords: trimRecords([...current.wakeRecords, ...newRecords]),
    });
    return { ok: true, alarmsImported: added.length, recordsImported: newRecords.length, warnings };
  }
}
