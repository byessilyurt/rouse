/**
 * RouseService — app-level orchestration the UI calls. OWNER: core agent. API is part of the contract.
 * Pure TS over Repository + AlarmBackend; unit-tested with an in-memory storage and a fake backend.
 *
 * Invariants:
 *  - Every alarm/settings mutation: validate → persist → backend.sync(all alarms, settings) → notify.
 *  - init(): migrate storage, applyLog(), sync(), subscribe to backend 'log' events.
 *  - applyLog(): getLog(meta.lastAppliedLogSeq) → apply each event idempotently (one-off-consumed →
 *    disable/delete; ring/snooze/dismiss/wake-check → WakeRecord) → setMeta → ackLog → sync if alarms changed.
 */
import type { AlarmBackend, SyncResult } from '../platform/AlarmBackend';
import type { Repository } from './storage';
import type { WakeStats } from './stats';
import type { ZoneOffsetFn } from './zone';
import type { Alarm, AlarmId, EpochMs, ImportMode, ImportResult, NextFire, RingSession, Settings, ValidationIssue, WakeRecord } from './types';
import { notImplemented } from './notImplemented';

export interface RouseServiceDeps {
  repo: Repository;
  backend: AlarmBackend;
  now: () => EpochMs;
  newId: () => string;
  appVersion: string;
  zone?: ZoneOffsetFn;
}

/** TS and backend disagree on an alarm's next fire (D-011). Surfaced on the health screen. */
export interface SchedulerMismatch {
  alarmId: AlarmId;
  ts: EpochMs | null;
  backend: EpochMs | null;
}

export type SaveAlarmResult = { ok: true; alarm: Alarm } | { ok: false; issues: ValidationIssue[] };

export class RouseService {
  constructor(deps: RouseServiceDeps) {
    notImplemented(`RouseService(${typeof deps})`);
  }
  init(): Promise<void> {
    return notImplemented('RouseService.init');
  }
  /** Any state change (alarms, settings, records, last sync). Returns unsubscribe. */
  subscribe(listener: () => void): () => void {
    return notImplemented(`RouseService.subscribe(${typeof listener})`);
  }
  /** Sorted by hour, minute, then createdAt. */
  getAlarms(): readonly Alarm[] {
    return notImplemented('RouseService.getAlarms');
  }
  getAlarm(id: AlarmId): Alarm | undefined {
    return notImplemented(`RouseService.getAlarm(${id})`);
  }
  getSettings(): Settings {
    return notImplemented('RouseService.getSettings');
  }
  /** Unsaved alarm pre-filled from settings.alarmDefaults. */
  newAlarmDraft(): Alarm {
    return notImplemented('RouseService.newAlarmDraft');
  }
  /** Normalise, validate, persist, sync. Clears skipUntil if hour/minute/days changed. */
  saveAlarm(alarm: Alarm): Promise<SaveAlarmResult> {
    return notImplemented(`RouseService.saveAlarm(${alarm.id})`);
  }
  deleteAlarm(id: AlarmId): Promise<void> {
    return notImplemented(`RouseService.deleteAlarm(${id})`);
  }
  setEnabled(id: AlarmId, enabled: boolean): Promise<void> {
    return notImplemented(`RouseService.setEnabled(${id}, ${enabled})`);
  }
  skipNext(id: AlarmId): Promise<void> {
    return notImplemented(`RouseService.skipNext(${id})`);
  }
  unskip(id: AlarmId): Promise<void> {
    return notImplemented(`RouseService.unskip(${id})`);
  }
  /** One-off alarm at napTime(now, minutes ?? settings.napMinutes), deleteAfterRing, label "Nap". */
  quickNap(minutes?: number): Promise<Alarm> {
    return notImplemented(`RouseService.quickNap(${minutes})`);
  }
  updateSettings(patch: Partial<Settings>): Promise<void> {
    return notImplemented(`RouseService.updateSettings(${Object.keys(patch).join(',')})`);
  }
  /** TS-computed next fire across enabled alarms. */
  nextFire(): NextFire | null {
    return notImplemented('RouseService.nextFire');
  }
  getLastSync(): SyncResult | null {
    return notImplemented('RouseService.getLastSync');
  }
  getSchedulerMismatches(): readonly SchedulerMismatch[] {
    return notImplemented('RouseService.getSchedulerMismatches');
  }
  getWakeRecords(): readonly WakeRecord[] {
    return notImplemented('RouseService.getWakeRecords');
  }
  getStats(): WakeStats {
    return notImplemented('RouseService.getStats');
  }
  /** Pretty-printed BackupFile JSON. */
  exportBackup(): string {
    return notImplemented('RouseService.exportBackup');
  }
  importBackup(json: string, mode: ImportMode): Promise<ImportResult> {
    return notImplemented(`RouseService.importBackup(${json.length}, ${mode})`);
  }
  applyLog(): Promise<void> {
    return notImplemented('RouseService.applyLog');
  }
  /** Merge JS-only metrics (mission time, failures, fallback) of a finished RingSession into its WakeRecord. Ignores test rings. */
  recordRingOutcome(session: RingSession, isTest: boolean): void {
    notImplemented(`RouseService.recordRingOutcome(${session.sessionId}, ${isTest})`);
  }
}
