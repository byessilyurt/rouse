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
  StorageMeta,
  WakeRecord,
} from './types';
import { notImplemented } from './notImplemented';

/** Subset of the Web Storage API (window.localStorage, or an in-memory fake in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Bring any previously stored shape (or null) up to the current PersistedState. Pure, never throws. */
export function migrateState(raw: unknown, now: EpochMs): PersistedState {
  return notImplemented(`migrateState(${typeof raw}, ${now})`);
}

/** Validate a backup file's text. Rejects other formats and versions newer than BACKUP_VERSION. */
export function parseBackup(json: string): { ok: true; backup: BackupFile; warnings: string[] } | { ok: false; error: string } {
  return notImplemented(`parseBackup(${json.length} chars)`);
}

/** Synchronous repository. Every mutation writes through to storage immediately. */
export class Repository {
  constructor(
    private readonly storage: StorageLike,
    private readonly now: () => EpochMs,
  ) {}

  getState(): Readonly<PersistedState> {
    return notImplemented(`Repository.getState ${typeof this.storage} ${typeof this.now}`);
  }
  getAlarms(): readonly Alarm[] {
    return notImplemented('Repository.getAlarms');
  }
  getAlarm(id: AlarmId): Alarm | undefined {
    return notImplemented(`Repository.getAlarm(${id})`);
  }
  /** Insert or replace by id; sets updatedAt. */
  upsertAlarm(alarm: Alarm): void {
    notImplemented(`Repository.upsertAlarm(${alarm.id})`);
  }
  deleteAlarm(id: AlarmId): void {
    notImplemented(`Repository.deleteAlarm(${id})`);
  }
  getSettings(): Settings {
    return notImplemented('Repository.getSettings');
  }
  saveSettings(settings: Settings): void {
    notImplemented(`Repository.saveSettings(${typeof settings})`);
  }
  getWakeRecords(): readonly WakeRecord[] {
    return notImplemented('Repository.getWakeRecords');
  }
  /** Insert or merge by id; trims to MAX_WAKE_RECORDS (oldest first). */
  upsertWakeRecord(record: WakeRecord): void {
    notImplemented(`Repository.upsertWakeRecord(${record.id})`);
  }
  getMeta(): StorageMeta {
    return notImplemented('Repository.getMeta');
  }
  setMeta(patch: Partial<StorageMeta>): void {
    notImplemented(`Repository.setMeta(${Object.keys(patch).join(',')})`);
  }
  loadRingProgress(sessionId: string): RingSession | null {
    return notImplemented(`Repository.loadRingProgress(${sessionId})`);
  }
  saveRingProgress(session: RingSession): void {
    notImplemented(`Repository.saveRingProgress(${session.sessionId})`);
  }
  clearRingProgress(sessionId: string): void {
    notImplemented(`Repository.clearRingProgress(${sessionId})`);
  }
  exportBackup(appVersion: string): BackupFile {
    return notImplemented(`Repository.exportBackup(${appVersion})`);
  }
  /**
   * Import a backup. 'replace' swaps alarms+settings+records; 'merge' adds alarms with new ids
   * (keeps existing), keeps current settings, merges records by id. Custom sounds not in
   * `knownCustomSoundIds` are replaced by DEFAULT_SOUND with a warning.
   */
  importBackup(json: string, mode: ImportMode, knownCustomSoundIds: readonly string[]): ImportResult {
    return notImplemented(`Repository.importBackup(${json.length}, ${mode}, ${knownCustomSoundIds.length})`);
  }
}
