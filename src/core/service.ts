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
import type { AlarmBackend, AlarmLogEvent, SyncResult } from '../platform/AlarmBackend';
import type { Repository } from './storage';
import type { WakeStats } from './stats';
import type { ZoneOffsetFn } from './zone';
import type { Alarm, AlarmId, EpochMs, ImportMode, ImportResult, NextFire, RingSession, Settings, ValidationIssue, WakeRecord } from './types';
import { LIMITS, MAX_ALARMS, createAlarm } from './defaults';
import { localZone } from './zone';
import { napTime, nextFire, nextOccurrence, skipNext } from './schedule';
import { computeStats } from './stats';
import { normalizeAlarm, parseSettings, validateAlarm } from './validation';

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

const NAP_LABEL = 'Nap';

export class RouseService {
  private readonly repo: Repository;
  private readonly backend: AlarmBackend;
  private readonly now: () => EpochMs;
  private readonly newId: () => string;
  private readonly appVersion: string;
  private readonly zone: ZoneOffsetFn;
  private readonly listeners = new Set<() => void>();
  private lastSync: SyncResult | null = null;
  private mismatches: SchedulerMismatch[] = [];
  private syncSeq = 0;
  private initPromise: Promise<void> | null = null;
  private logChain: Promise<void> = Promise.resolve();
  private unsubscribeBackend: (() => void) | null = null;
  /** recordRingOutcome is idempotent per finished controller (sessionId + ring start + phase). */
  private readonly recordedOutcomes = new Set<string>();

  constructor(deps: RouseServiceDeps) {
    this.repo = deps.repo;
    this.backend = deps.backend;
    this.now = deps.now;
    this.newId = deps.newId;
    this.appVersion = deps.appVersion;
    this.zone = deps.zone ?? localZone;
  }

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.repo.getState(); // load + migrate storage
        await this.backend.init();
        this.unsubscribeBackend ??= this.backend.subscribe((event) => {
          if (event.type === 'log') void this.applyLog().catch(() => undefined);
        });
        await this.applyLog();
        await this.sync();
      })();
      // A failed init may be retried by calling init() again.
      this.initPromise.catch(() => {
        this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  /** Any state change (alarms, settings, records, last sync). Returns unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Sorted by hour, minute, then createdAt. */
  getAlarms(): readonly Alarm[] {
    return [...this.repo.getAlarms()].sort((a, b) => a.hour - b.hour || a.minute - b.minute || a.createdAt - b.createdAt);
  }
  getAlarm(id: AlarmId): Alarm | undefined {
    return this.repo.getAlarm(id);
  }
  getSettings(): Settings {
    return this.repo.getSettings();
  }

  /** Unsaved alarm pre-filled from settings.alarmDefaults. */
  newAlarmDraft(): Alarm {
    return createAlarm({ id: this.newId(), now: this.now(), defaults: this.repo.getSettings().alarmDefaults });
  }

  /** Normalise, validate, persist, sync. Clears skipUntil if hour/minute/days changed. */
  async saveAlarm(alarm: Alarm): Promise<SaveAlarmResult> {
    const normalized = normalizeAlarm(alarm);
    const issues = validateAlarm(normalized);
    if (issues.length > 0) return { ok: false, issues };
    const existing = this.repo.getAlarm(normalized.id);
    if (!existing && this.repo.getAlarms().length >= MAX_ALARMS) {
      return { ok: false, issues: [{ path: '', message: `You can have at most ${MAX_ALARMS} alarms.` }] };
    }
    const toSave: Alarm = { ...normalized };
    if (existing) {
      toSave.createdAt = existing.createdAt;
      const timeChanged =
        existing.hour !== toSave.hour || existing.minute !== toSave.minute || existing.days.join(',') !== toSave.days.join(',');
      if (timeChanged) toSave.skipUntil = null;
    }
    // A skip marker in the past is stale; clear it lazily.
    if (toSave.skipUntil !== null && toSave.skipUntil <= this.now()) toSave.skipUntil = null;
    this.repo.upsertAlarm(toSave);
    this.notify();
    await this.sync();
    return { ok: true, alarm: this.repo.getAlarm(toSave.id) ?? toSave };
  }

  async deleteAlarm(id: AlarmId): Promise<void> {
    if (!this.repo.getAlarm(id)) return;
    this.repo.deleteAlarm(id);
    this.notify();
    await this.sync();
  }

  async setEnabled(id: AlarmId, enabled: boolean): Promise<void> {
    await this.patchAlarm(id, (a) => (a.enabled === enabled ? null : { ...a, enabled }));
  }

  async skipNext(id: AlarmId): Promise<void> {
    await this.patchAlarm(id, (a) => skipNext(a, this.now(), this.zone));
  }

  async unskip(id: AlarmId): Promise<void> {
    await this.patchAlarm(id, (a) => (a.skipUntil === null ? null : { ...a, skipUntil: null }));
  }

  /** One-off alarm at napTime(now, minutes ?? settings.napMinutes), deleteAfterRing, label "Nap". */
  async quickNap(minutes?: number): Promise<Alarm> {
    const settings = this.repo.getSettings();
    const raw = minutes ?? settings.napMinutes;
    const length = Math.min(LIMITS.napMinutes.max, Math.max(1, Math.round(Number.isFinite(raw) ? raw : settings.napMinutes)));
    const now = this.now();
    const { hour, minute } = napTime(now, length, this.zone);
    const nap: Alarm = {
      ...createAlarm({ id: this.newId(), now, hour, minute, days: [], defaults: settings.alarmDefaults }),
      label: NAP_LABEL,
      deleteAfterRing: true,
    };
    this.repo.upsertAlarm(normalizeAlarm(nap));
    this.notify();
    await this.sync();
    return this.repo.getAlarm(nap.id) ?? nap;
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const merged = parseSettings({ ...this.repo.getSettings(), ...patch });
    this.repo.saveSettings(merged);
    this.notify();
    await this.sync();
  }

  /** TS-computed next fire across enabled alarms. */
  nextFire(): NextFire | null {
    return nextFire(this.repo.getAlarms(), this.now(), this.zone);
  }
  getLastSync(): SyncResult | null {
    return this.lastSync;
  }
  getSchedulerMismatches(): readonly SchedulerMismatch[] {
    return this.mismatches;
  }
  getWakeRecords(): readonly WakeRecord[] {
    return this.repo.getWakeRecords();
  }
  getStats(): WakeStats {
    return computeStats(this.repo.getWakeRecords(), this.now(), this.zone);
  }

  /** Pretty-printed BackupFile JSON. */
  exportBackup(): string {
    return JSON.stringify(this.repo.exportBackup(this.appVersion), null, 2);
  }

  async importBackup(json: string, mode: ImportMode): Promise<ImportResult> {
    let known: string[] = [];
    try {
      known = (await this.backend.listSounds()).flatMap((s) => (s.ref.kind === 'custom' ? [s.ref.id] : []));
    } catch {
      // No sound list: every custom sound in the file falls back to the default (with warnings).
    }
    const result = this.repo.importBackup(json, mode, known);
    if (result.ok) {
      this.notify();
      await this.sync();
    }
    return result;
  }

  /** Serialised: concurrent calls (init + 'log' event) never apply the same events twice. */
  applyLog(): Promise<void> {
    const run = this.logChain.then(() => this.applyLogNow());
    this.logChain = run.catch(() => undefined);
    return run;
  }

  /** Merge JS-only metrics (mission time, failures, fallback) of a finished RingSession into its WakeRecord. Ignores test rings. */
  recordRingOutcome(session: RingSession, isTest: boolean): void {
    if (isTest || session.source === 'test') return;
    const key = `${session.sessionId}:${session.ringStartedAt}:${session.phase}`;
    if (this.recordedOutcomes.has(key)) return;
    this.recordedOutcomes.add(key);
    const record = this.recordFor(session.sessionId, session.alarmId, { firstRangAt: session.episodeStartedAt });
    const dismissed = session.phase === 'dismissed';
    this.repo.upsertWakeRecord({
      ...record,
      label: record.label || session.alarm.label,
      missionTimeMs: record.missionTimeMs + session.missionTimeMs,
      failedAttempts: record.failedAttempts + session.totalFailedAttempts,
      usedFallback: record.usedFallback || session.usedFallback,
      missionsCompleted: record.missionsCompleted + (dismissed ? session.plan.length : 0),
      snoozeCount: Math.max(record.snoozeCount, session.snoozeCount + (session.phase === 'snoozed' ? 1 : 0)),
      outcome: dismissed ? 'dismissed' : record.outcome,
      dismissedAt: dismissed && record.dismissedAt === null ? this.now() : record.dismissedAt,
    });
    this.notify();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  private async patchAlarm(id: AlarmId, change: (a: Alarm) => Alarm | null): Promise<void> {
    const current = this.repo.getAlarm(id);
    if (!current) return;
    const next = change(current);
    if (next === null) return;
    this.repo.upsertAlarm(next);
    this.notify();
    await this.sync();
  }

  /** Full-state sync; only the latest response updates lastSync/mismatches. */
  private async sync(): Promise<void> {
    const seq = ++this.syncSeq;
    const alarms = this.repo.getAlarms();
    const result = await this.backend.sync(alarms, this.repo.getSettings());
    if (seq !== this.syncSeq) return;
    const now = this.now();
    this.lastSync = result;
    this.mismatches = [];
    for (const info of result.alarms) {
      const alarm = alarms.find((a) => a.id === info.alarmId);
      if (!alarm) continue;
      const ts = alarm.enabled ? nextOccurrence(alarm, now, this.zone) : null;
      // An occurrence that passed between the backend's computation and ours is not a disagreement.
      if (ts !== info.nextFireAt && !(info.nextFireAt !== null && info.nextFireAt <= now)) {
        this.mismatches.push({ alarmId: info.alarmId, ts, backend: info.nextFireAt });
      }
    }
    this.notify();
  }

  private recordFor(sessionId: string, alarmId: AlarmId, init: Partial<WakeRecord> = {}): WakeRecord {
    const existing = this.repo.getWakeRecords().find((r) => r.id === sessionId);
    if (existing) return existing;
    return {
      id: sessionId,
      alarmId,
      label: this.repo.getAlarm(alarmId)?.label ?? '',
      scheduledFor: null,
      firstRangAt: null,
      dismissedAt: null,
      // Placeholder until the episode ends; stats treat an unfinished episode today as open.
      outcome: 'abandoned',
      snoozeCount: 0,
      missionsCompleted: 0,
      missionTimeMs: 0,
      failedAttempts: 0,
      usedFallback: false,
      usedNativeFallback: false,
      wakeCheck: 'off',
      wakeCheckReRings: 0,
      ...init,
    };
  }

  private async applyLogNow(): Promise<void> {
    const fromSeq = this.repo.getMeta().lastAppliedLogSeq;
    const events = [...(await this.backend.getLog(fromSeq))].sort((a, b) => a.seq - b.seq);
    let lastSeq = fromSeq;
    let alarmsChanged = false;
    let changed = false;
    for (const ev of events) {
      if (ev.seq <= lastSeq) continue; // idempotent by seq
      if (this.applyEvent(ev)) alarmsChanged = true;
      lastSeq = ev.seq;
      changed = true;
    }
    if (!changed) return;
    this.repo.setMeta({ lastAppliedLogSeq: lastSeq });
    this.notify();
    await this.backend.ackLog(lastSeq);
    if (alarmsChanged) await this.sync();
  }

  /** Apply one log event. Returns true if alarms changed (needs a sync). */
  private applyEvent(ev: AlarmLogEvent): boolean {
    const upsert = (patch: (r: WakeRecord) => Partial<WakeRecord>, init?: Partial<WakeRecord>): void => {
      const r = this.recordFor(ev.sessionId, ev.alarmId, init);
      this.repo.upsertWakeRecord({ ...r, ...patch(r) });
    };
    switch (ev.type) {
      case 'ring-started':
        upsert(
          (r) => ({
            firstRangAt: r.firstRangAt ?? ev.at,
            scheduledFor: r.scheduledFor ?? ev.scheduledFor,
          }),
          { firstRangAt: ev.at, scheduledFor: ev.scheduledFor },
        );
        return false;
      case 'snoozed':
        upsert((r) => ({ snoozeCount: Math.max(r.snoozeCount, ev.snoozeCount) }));
        return false;
      case 'dismissed':
        upsert((r) => ({
          outcome: 'dismissed',
          dismissedAt: ev.at,
          usedFallback: r.usedFallback || ev.via === 'fallback',
          usedNativeFallback: r.usedNativeFallback || ev.via === 'native-fallback',
          wakeCheck: ev.wakeCheckAt !== null ? 'pending' : r.wakeCheckReRings > 0 ? 'failed' : r.wakeCheck === 'pending' ? 'off' : r.wakeCheck,
        }));
        return false;
      case 'wake-check-shown':
        upsert(() => ({ wakeCheck: 'pending' }));
        return false;
      case 'wake-check-confirmed':
        upsert(() => ({ wakeCheck: 'confirmed' }));
        return false;
      case 'wake-check-failed':
        upsert((r) => ({ wakeCheck: 'failed', wakeCheckReRings: Math.max(r.wakeCheckReRings, ev.reRingCount) }));
        return false;
      case 'missed':
        upsert((r) => ({ outcome: r.outcome === 'dismissed' ? r.outcome : 'missed', scheduledFor: r.scheduledFor ?? ev.scheduledFor }), {
          scheduledFor: ev.scheduledFor,
        });
        return false;
      case 'superseded':
        upsert((r) => ({
          outcome: r.outcome === 'dismissed' ? 'dismissed' : 'superseded',
          wakeCheck: r.wakeCheck === 'pending' ? 'off' : r.wakeCheck,
        }));
        return false;
      case 'episode-ended':
        upsert((r) => {
          if (ev.reason === 'wake-check-confirmed') return { wakeCheck: 'confirmed' };
          if (ev.reason === 'superseded') {
            return { outcome: r.outcome === 'dismissed' ? 'dismissed' : 'superseded', wakeCheck: r.wakeCheck === 'pending' ? 'off' : r.wakeCheck };
          }
          return { outcome: 'dismissed', wakeCheck: r.wakeCheck === 'pending' ? (r.wakeCheckReRings > 0 ? 'failed' : 'off') : r.wakeCheck };
        });
        this.repo.clearRingProgress(ev.sessionId);
        return false;
      case 'merged':
        return false; // the ringing episode's record covers it
      case 'one-off-consumed': {
        const alarm = this.repo.getAlarm(ev.alarmId);
        // Skip if the user edited the alarm after it fired (e.g. re-enabled it for tomorrow).
        if (!alarm || alarm.updatedAt > ev.at) return false;
        if (alarm.deleteAfterRing) {
          this.repo.deleteAlarm(alarm.id);
          return true;
        }
        if (!alarm.enabled) return false;
        this.repo.upsertAlarm({ ...alarm, enabled: false, skipUntil: null });
        return true;
      }
    }
  }
}
