import { describe, expect, it } from 'vitest';
import { CORRUPT_KEY_PREFIX, Repository, migrateState, parseBackup, parseWakeRecord } from '../../../src/core/storage';
import {
  BACKUP_FORMAT,
  DEFAULT_SOUND,
  MAX_ALARMS,
  MAX_WAKE_RECORDS,
  RING_PROGRESS_KEY_PREFIX,
  STORAGE_KEY,
  defaultSettings,
} from '../../../src/core/defaults';
import type { BackupFile, RingSession, WakeRecord } from '../../../src/core/types';
import { MemoryStorage, makeAlarm } from './testUtils';

const NOW = 1_700_000_000_000;

function record(id: string, scheduledFor: number | null, extra: Partial<WakeRecord> = {}): WakeRecord {
  return {
    id,
    alarmId: 'a1',
    label: '',
    scheduledFor,
    firstRangAt: scheduledFor,
    dismissedAt: null,
    outcome: 'dismissed',
    snoozeCount: 0,
    missionsCompleted: 1,
    missionTimeMs: 1000,
    failedAttempts: 0,
    usedFallback: false,
    usedNativeFallback: false,
    wakeCheck: 'off',
    wakeCheckReRings: 0,
    ...extra,
  };
}

function backup(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    format: 'rouse-backup',
    version: 1,
    exportedAt: 1,
    appVersion: '0.1.0',
    alarms: [makeAlarm({ id: 'b1', label: 'Work' })],
    settings: { ...defaultSettings(), napMinutes: 30 },
    wakeRecords: [record('r1', 100)],
    ...overrides,
  };
}

describe('migrateState', () => {
  it('null / undefined → fresh state', () => {
    const s = migrateState(null, NOW);
    expect(s).toEqual({ schemaVersion: 1, alarms: [], settings: defaultSettings(), wakeRecords: [], meta: { lastAppliedLogSeq: 0, createdAt: NOW } });
    expect(migrateState(undefined, NOW).alarms).toEqual([]);
  });

  it('v0 object (no schemaVersion) → v1, keeping valid alarms and dropping broken ones', () => {
    const v0 = { alarms: [makeAlarm({ id: 'x' }), { id: 'broken' }, makeAlarm({ id: 'x' })], settings: { napMinutes: 45 } };
    const s = migrateState(v0, NOW);
    expect(s.schemaVersion).toBe(1);
    expect(s.alarms.map((a) => a.id)).toEqual(['x']);
    expect(s.settings.napMinutes).toBe(45);
    expect(s.meta).toEqual({ lastAppliedLogSeq: 0, createdAt: NOW });
  });

  it('v0 bare alarm array → v1', () => {
    expect(migrateState([makeAlarm({ id: 'x' })], NOW).alarms.map((a) => a.id)).toEqual(['x']);
  });

  it('v1 passes through (sanitised)', () => {
    const v1 = { schemaVersion: 1, alarms: [makeAlarm()], settings: defaultSettings(), wakeRecords: [record('r', 5)], meta: { lastAppliedLogSeq: 7, createdAt: 3 } };
    expect(migrateState(JSON.parse(JSON.stringify(v1)), NOW)).toEqual(v1);
    expect(migrateState(JSON.stringify(v1), NOW)).toEqual(v1);
  });

  it('newer / unknown versions and junk → fresh, never throws', () => {
    for (const raw of [{ schemaVersion: 2, alarms: [makeAlarm()] }, { schemaVersion: 'x' }, 42, 'not json', true]) {
      expect(migrateState(raw, NOW).alarms).toEqual([]);
    }
  });
});

describe('Repository', () => {
  it('creates and writes a fresh state on first load', () => {
    const storage = new MemoryStorage();
    const repo = new Repository(storage, () => NOW);
    expect(repo.getAlarms()).toEqual([]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).schemaVersion).toBe(1);
    expect(repo.getLoadWarning()).toBeNull();
  });

  it('migrates v0 on load and writes back v1', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ alarms: [makeAlarm({ id: 'old' })] }));
    const repo = new Repository(storage, () => NOW);
    expect(repo.getAlarm('old')?.id).toBe('old');
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).schemaVersion).toBe(1);
  });

  it.each([
    ['corrupt JSON', '{"alarms": [', /unreadable/],
    ['future version', JSON.stringify({ schemaVersion: 99, alarms: [] }), /newer/],
    ['wrong type', '"hello"', /newer or unknown/],
  ])('%s: backs up the raw text, starts fresh, sets a warning', (_name, text, pattern) => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, text);
    const repo = new Repository(storage, () => NOW);
    expect(repo.getAlarms()).toEqual([]);
    expect(storage.getItem(`${CORRUPT_KEY_PREFIX}${NOW}`)).toBe(text);
    expect(repo.getLoadWarning()).toMatch(pattern);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).schemaVersion).toBe(1);
  });

  it('still starts fresh when the corrupt backup cannot be written', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{');
    const original = storage.setItem.bind(storage);
    storage.setItem = (k: string, v: string) => {
      if (k.startsWith(CORRUPT_KEY_PREFIX)) throw new Error('quota');
      original(k, v);
    };
    const repo = new Repository(storage, () => NOW);
    expect(repo.getLoadWarning()).toMatch(/started fresh\.$/);
  });

  it('treats a throwing getItem as empty storage', () => {
    const storage = new MemoryStorage();
    storage.getItem = () => {
      throw new Error('denied');
    };
    expect(new Repository(storage, () => NOW).getAlarms()).toEqual([]);
  });

  it('writes through every mutation and survives a reload', () => {
    const storage = new MemoryStorage();
    let t = NOW;
    const repo = new Repository(storage, () => t);
    repo.upsertAlarm(makeAlarm({ id: 'a', updatedAt: 1 }));
    expect(repo.getAlarm('a')?.updatedAt).toBe(NOW);
    t += 5;
    repo.upsertAlarm({ ...makeAlarm({ id: 'a' }), label: 'Edited' });
    repo.upsertAlarm(makeAlarm({ id: 'b' }));
    repo.deleteAlarm('b');
    repo.deleteAlarm('missing');
    repo.saveSettings({ ...defaultSettings(), theme: 'dark' });
    repo.setMeta({ lastAppliedLogSeq: 12 });
    repo.upsertWakeRecord(record('r1', 10));
    repo.upsertWakeRecord({ ...record('r1', 10), snoozeCount: 2 });

    const reloaded = new Repository(storage, () => t);
    expect(reloaded.getAlarms().map((a) => [a.id, a.label, a.updatedAt])).toEqual([['a', 'Edited', NOW + 5]]);
    expect(reloaded.getSettings().theme).toBe('dark');
    expect(reloaded.getMeta()).toEqual({ lastAppliedLogSeq: 12, createdAt: NOW });
    expect(reloaded.getWakeRecords()).toHaveLength(1);
    expect(reloaded.getWakeRecords()[0]?.snoozeCount).toBe(2);
    expect(reloaded.getState().schemaVersion).toBe(1);
  });

  it('does not mutate previously returned snapshots', () => {
    const repo = new Repository(new MemoryStorage(), () => NOW);
    const before = repo.getAlarms();
    repo.upsertAlarm(makeAlarm());
    expect(before).toEqual([]);
  });

  it('trims wake records to MAX_WAKE_RECORDS, dropping the oldest', () => {
    const repo = new Repository(new MemoryStorage(), () => NOW);
    for (let i = MAX_WAKE_RECORDS + 4; i >= 0; i--) repo.upsertWakeRecord(record(`r${i}`, i * 1000));
    const ids = repo.getWakeRecords().map((r) => r.id);
    expect(ids).toHaveLength(MAX_WAKE_RECORDS);
    expect(ids).not.toContain('r0');
    expect(ids).not.toContain('r4');
    expect(ids[0]).toBe('r5');
    repo.clearWakeRecords();
    expect(repo.getWakeRecords()).toEqual([]);
  });

  it('persists, validates and clears ring progress', () => {
    const storage = new MemoryStorage();
    const repo = new Repository(storage, () => NOW);
    const session = { sessionId: 's1', alarm: makeAlarm(), plan: [], missionIndex: 1 } as unknown as RingSession;
    expect(repo.loadRingProgress('s1')).toBeNull();
    repo.saveRingProgress(session);
    expect(repo.loadRingProgress('s1')).toEqual(session);
    storage.setItem(`${RING_PROGRESS_KEY_PREFIX}s2`, JSON.stringify({ ...session, sessionId: 'other' }));
    expect(repo.loadRingProgress('s2')).toBeNull();
    storage.setItem(`${RING_PROGRESS_KEY_PREFIX}s3`, '{oops');
    expect(repo.loadRingProgress('s3')).toBeNull();
    repo.clearRingProgress('s1');
    expect(repo.loadRingProgress('s1')).toBeNull();
  });
});

describe('parseWakeRecord', () => {
  it('fills defaults and rejects records without ids', () => {
    expect(parseWakeRecord({ id: 'x', alarmId: 'a', outcome: 'weird', wakeCheck: 'maybe', snoozeCount: -2 })).toMatchObject({
      id: 'x',
      outcome: 'abandoned',
      wakeCheck: 'off',
      snoozeCount: 0,
      scheduledFor: null,
    });
    expect(parseWakeRecord({ alarmId: 'a' })).toBeNull();
    expect(parseWakeRecord('x')).toBeNull();
  });
});

describe('parseBackup', () => {
  it('accepts a valid backup', () => {
    const r = parseBackup(JSON.stringify(backup()));
    expect(r).toEqual({ ok: true, warnings: [], backup: backup() });
  });
  it.each([
    ['not json', '{', /not valid JSON/],
    ['other format', JSON.stringify({ format: 'alarmy', version: 1 }), /not a Rouse backup/],
    ['array', '[]', /not a Rouse backup/],
    ['newer version', JSON.stringify({ ...backup(), version: 2 }), /newer version/],
    ['bad version', JSON.stringify({ ...backup(), version: 0 }), /unknown version/],
    ['no alarms', JSON.stringify({ format: BACKUP_FORMAT, version: 1 }), /no alarm list/],
  ])('rejects %s', (_n, text, pattern) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(pattern);
  });
  it('skips invalid / duplicate alarms and bad records with warnings', () => {
    const file = {
      ...backup(),
      alarms: [makeAlarm({ id: 'ok' }), { id: 'q', hour: 7, minute: 5, label: 'QR', missions: [{ type: 'qr' }] }, makeAlarm({ id: 'ok' }), 'junk'],
      wakeRecords: [record('r1', 1), { nope: true }],
      settings: undefined,
    };
    const r = parseBackup(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.alarms.map((a) => a.id)).toEqual(['ok']);
    expect(r.backup.settings).toEqual(defaultSettings());
    expect(r.warnings).toEqual([
      'Alarm 2 (07:05 "QR") was skipped: Scan the code you want to use before saving.',
      'Alarm 3 (07:00) was skipped: it appears twice in the file.',
      'Alarm 4 was skipped: Not an alarm.',
      'The backup has no settings; defaults are used.',
      '1 statistics entry was skipped.',
    ]);
  });
  it('caps alarms at MAX_ALARMS and tolerates a missing / malformed record list', () => {
    const many = Array.from({ length: MAX_ALARMS + 2 }, (_, i) => makeAlarm({ id: `a${i}` }));
    const r = parseBackup(JSON.stringify({ ...backup({ alarms: many }), wakeRecords: undefined }));
    expect(r.ok && r.backup.alarms).toHaveLength(MAX_ALARMS);
    expect(r.ok && r.backup.wakeRecords).toEqual([]);
    expect(r.ok && r.warnings).toHaveLength(2);
    const bad = parseBackup(JSON.stringify({ ...backup(), wakeRecords: 'x' }));
    expect(bad.ok && bad.warnings).toEqual(['Statistics in the backup could not be read.']);
  });
});

describe('export / import', () => {
  function seeded(): { repo: Repository; storage: MemoryStorage } {
    const storage = new MemoryStorage();
    const repo = new Repository(storage, () => NOW);
    repo.upsertAlarm(makeAlarm({ id: 'mine', label: 'Mine' }));
    repo.upsertWakeRecord(record('r-mine', 50));
    repo.setMeta({ lastAppliedLogSeq: 9 });
    return { repo, storage };
  }

  it('export → import(replace) round-trips', () => {
    const { repo } = seeded();
    repo.saveSettings({ ...defaultSettings(), napMinutes: 33 });
    const text = JSON.stringify(repo.exportBackup('1.2.3'));
    const exported = JSON.parse(text) as BackupFile;
    expect(exported).toMatchObject({ format: 'rouse-backup', version: 1, exportedAt: NOW, appVersion: '1.2.3' });

    const other = new Repository(new MemoryStorage(), () => NOW);
    other.upsertAlarm(makeAlarm({ id: 'gone' }));
    const r = other.importBackup(text, 'replace', []);
    expect(r).toEqual({ ok: true, alarmsImported: 1, recordsImported: 1, warnings: [] });
    expect(other.getAlarms()).toEqual(repo.getAlarms());
    expect(other.getSettings().napMinutes).toBe(33);
    expect(other.getWakeRecords()).toEqual(repo.getWakeRecords());
  });

  it('replace keeps meta (log bookkeeping)', () => {
    const { repo } = seeded();
    repo.importBackup(JSON.stringify(backup()), 'replace', []);
    expect(repo.getMeta().lastAppliedLogSeq).toBe(9);
    expect(repo.getAlarms().map((a) => a.id)).toEqual(['b1']);
  });

  it('merge adds alarms with new ids, keeps settings, merges records by id', () => {
    const { repo } = seeded();
    const file = backup({ alarms: [makeAlarm({ id: 'mine', label: 'Twin' })], wakeRecords: [record('r-mine', 50, { snoozeCount: 9 }), record('r-new', 60)] });
    const r = repo.importBackup(JSON.stringify(file), 'merge', []);
    expect(r).toEqual({ ok: true, alarmsImported: 1, recordsImported: 1, warnings: [] });
    const alarms = repo.getAlarms();
    expect(alarms).toHaveLength(2);
    const twin = alarms.find((a) => a.label === 'Twin');
    expect(twin?.id).not.toBe('mine');
    expect(twin?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(repo.getSettings().napMinutes).toBe(defaultSettings().napMinutes);
    expect(repo.getWakeRecords().find((x) => x.id === 'r-mine')?.snoozeCount).toBe(0);
    expect(repo.getWakeRecords().map((x) => x.id)).toEqual(['r-mine', 'r-new']);
  });

  it('merge respects MAX_ALARMS', () => {
    const repo = new Repository(new MemoryStorage(), () => NOW);
    for (let i = 0; i < MAX_ALARMS - 1; i++) repo.upsertAlarm(makeAlarm({ id: `x${i}` }));
    const r = repo.importBackup(JSON.stringify(backup({ alarms: [makeAlarm({ id: 'p' }), makeAlarm({ id: 'q' })] })), 'merge', []);
    expect(r.ok && r.alarmsImported).toBe(1);
    expect(r.ok && r.warnings[0]).toMatch(/Only 1 of 2/);
    expect(repo.getAlarms()).toHaveLength(MAX_ALARMS);
  });

  it('replaces unknown custom sounds with the default (one warning per sound)', () => {
    const repo = new Repository(new MemoryStorage(), () => NOW);
    const custom = { kind: 'custom' as const, id: 'snd-1', name: 'birds.mp3' };
    const known = { kind: 'custom' as const, id: 'snd-2', name: 'rain.mp3' };
    const settings = defaultSettings();
    settings.alarmDefaults.sound = custom;
    const file = backup({
      alarms: [makeAlarm({ id: 'a', sound: custom }), makeAlarm({ id: 'b', sound: custom }), makeAlarm({ id: 'c', sound: known })],
      settings,
    });
    const r = repo.importBackup(JSON.stringify(file), 'replace', ['snd-2']);
    expect(r.ok && r.warnings).toEqual([`Custom sound "birds.mp3" isn't on this device, so the default sound is used instead.`]);
    expect(repo.getAlarms().map((a) => a.sound)).toEqual([DEFAULT_SOUND, DEFAULT_SOUND, known]);
    expect(repo.getSettings().alarmDefaults.sound).toEqual(DEFAULT_SOUND);
  });

  it('a malformed file changes nothing', () => {
    const { repo, storage } = seeded();
    const before = storage.getItem(STORAGE_KEY);
    expect(repo.importBackup('{"format":"rouse-backup","version":3}', 'replace', [])).toEqual({
      ok: false,
      error: 'This backup was made by a newer version of Rouse. Update the app and try again.',
    });
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });
});
