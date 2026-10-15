/** Shared helpers for core unit tests (not a test file itself). */
import { vi } from 'vitest';
import type { ActiveRing, AlarmBackend, AlarmLogEvent, SyncResult } from '../../../src/platform/AlarmBackend';
import type { Alarm, EpochMs, Settings } from '../../../src/core/types';
import { createAlarm } from '../../../src/core/defaults';
import type { StorageLike } from '../../../src/core/storage';
import type { TimerApi } from '../../../src/core/ringController';
import { nextOccurrence } from '../../../src/core/schedule';
import type { ZoneOffsetFn } from '../../../src/core/zone';

export const iso = (s: string): EpochMs => {
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`bad ISO ${s}`);
  return t;
};

export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.writes++;
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export function makeAlarm(overrides: Partial<Alarm> = {}): Alarm {
  return { ...createAlarm({ id: overrides.id ?? 'a1', now: overrides.createdAt ?? 1_000 }), ...overrides };
}

/** Manual clock + timers: advance() fires due timers in order. */
export class FakeClock implements TimerApi {
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  constructor(public t: number) {}
  now = (): number => this.t;
  set(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clear(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  get pending(): number {
    return this.timers.size;
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}

export function makeRing(alarm: Alarm, overrides: Partial<ActiveRing> = {}): ActiveRing {
  return {
    sessionId: 's1',
    alarmId: alarm.id,
    alarm,
    source: 'scheduled',
    state: 'ringing',
    scheduledFor: 1_000_000,
    episodeStartedAt: 1_000_000,
    ringStartedAt: 1_000_000,
    snoozeCount: 0,
    snoozeUntil: null,
    wakeCheckAt: null,
    wakeCheckDeadlineAt: null,
    wakeCheckReRings: 0,
    silenced: false,
    nativeFallbackShown: false,
    isTest: false,
    ...overrides,
  };
}

/** In-memory AlarmBackend whose sync computes next fires with the TS scheduler (or an override). */
export class FakeBackend implements AlarmBackend {
  readonly kind = 'web' as const;
  readonly capabilities = { canWakeLockedDevice: false, canLockVolume: false, canPickCustomSound: false, hasNativeFallback: false };
  log: AlarmLogEvent[] = [];
  acked = 0;
  listeners = new Set<(e: Parameters<Parameters<AlarmBackend['subscribe']>[0]>[0]) => void>();
  syncCalls: { alarms: Alarm[]; settings: Settings }[] = [];
  /** Override a computed next fire per alarm id (simulates a Java/TS disagreement). */
  nextFireOverride = new Map<string, EpochMs | null>();
  customSounds: string[] = [];
  constructor(
    private readonly now: () => EpochMs,
    private readonly zone: ZoneOffsetFn,
  ) {}
  init = vi.fn(async () => {});
  sync = vi.fn(async (alarms: readonly Alarm[], settings: Settings): Promise<SyncResult> => {
    this.syncCalls.push({ alarms: JSON.parse(JSON.stringify(alarms)), settings });
    const infos = alarms.map((a) => ({
      alarmId: a.id,
      nextFireAt: this.nextFireOverride.has(a.id)
        ? (this.nextFireOverride.get(a.id) as EpochMs | null)
        : a.enabled
          ? nextOccurrence(a, this.now(), this.zone)
          : null,
    }));
    return { next: null, alarms: infos, bedtimeReminderAt: null };
  });
  getNextFire = vi.fn(async () => null);
  getHealth = vi.fn(async () => ({ platform: 'web' as const, sdkInt: null, manufacturer: null, checks: [], checkedAt: 0 }));
  requestFix = vi.fn(async () => 'unsupported' as const);
  testAlarm = vi.fn(async () => ({ fireAt: 0 }));
  getActiveRing = vi.fn(async () => null);
  missionUiReady = vi.fn(async () => {});
  setSilenced = vi.fn(async () => {});
  snooze = vi.fn(async () => ({ snoozeUntil: 0 }));
  dismiss = vi.fn(async () => ({ wakeCheckAt: null }));
  confirmAwake = vi.fn(async () => {});
  getLog = vi.fn(async (afterSeq: number) => this.log.filter((e) => e.seq > afterSeq));
  ackLog = vi.fn(async (through: number) => {
    this.acked = through;
  });
  listSounds = vi.fn(async () => this.customSounds.map((id) => ({ ref: { kind: 'custom' as const, id, name: id }, name: id, durationMs: null })));
  previewSound = vi.fn(async () => {});
  stopPreview = vi.fn(async () => {});
  pickCustomSound = vi.fn(async () => null);
  deleteCustomSound = vi.fn(async () => {});
  subscribe(listener: (e: Parameters<Parameters<AlarmBackend['subscribe']>[0]>[0]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(e: Parameters<Parameters<AlarmBackend['subscribe']>[0]>[0]): void {
    for (const l of this.listeners) l(e);
  }
}
