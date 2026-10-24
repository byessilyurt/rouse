/**
 * NativeAlarmBackend — OWNER: native agent.
 * Thin adapter: AlarmBackend → `Rouse` plugin (RousePlugin.ts). No business logic here; the
 * shapes are pass-through. Maps plugin listeners to BackendEvent; unwraps `{ ring }` etc.
 */
import type { PluginListenerHandle } from '@capacitor/core';
import type {
  ActiveRing,
  AlarmBackend,
  AlarmLogEvent,
  BackendCapabilities,
  BackendEvent,
  BackendListener,
  DismissResult,
  DismissToken,
  FixOutcome,
  HealthCheckId,
  HealthStatus,
  SoundInfo,
  SyncResult,
} from '../AlarmBackend';
import type { Alarm, EpochMs, NextFire, Settings, SoundRef } from '../../core/types';
import { MAX_SILENCE_LEASE_MS, NATIVE_MIRROR_VERSION } from '../../core/defaults';
import { formatDiagnostics } from '../diagnostics';
import { Rouse } from './RousePlugin';
import type { NativeSettingsMirror } from './RousePlugin';

const CAPABILITIES: BackendCapabilities = {
  canWakeLockedDevice: true,
  canLockVolume: true,
  canPickCustomSound: true,
  hasNativeFallback: true,
};

/** Subset of Settings mirrored to Java with every sync. */
export function toNativeSettings(settings: Settings): NativeSettingsMirror {
  return {
    bedtimeReminder: { enabled: settings.bedtimeReminder.enabled, sleepGoalMin: settings.bedtimeReminder.sleepGoalMin },
    silenceLeaseMs: settings.silenceWhileSolvingSec * 1000,
  };
}

export function createNativeAlarmBackend(): AlarmBackend {
  const listeners = new Set<BackendListener>();
  let initPromise: Promise<void> | null = null;
  const handles: PluginListenerHandle[] = [];

  const dispatch = (event: BackendEvent): void => {
    for (const l of [...listeners]) {
      try {
        l(event);
      } catch (err) {
        console.error('[rouse] backend listener failed', err);
      }
    }
  };

  async function registerListeners(): Promise<void> {
    handles.push(
      await Rouse.addListener('ring', (data) => dispatch({ type: 'ring', ring: data.ring })),
      await Rouse.addListener('wakeCheck', (data) => dispatch({ type: 'wake-check', ring: data.ring })),
      await Rouse.addListener('ringState', (data) => dispatch({ type: 'ring-state', ring: data.ring ?? null })),
      await Rouse.addListener('log', () => dispatch({ type: 'log' })),
      await Rouse.addListener('healthChanged', () => dispatch({ type: 'health-changed' })),
    );
  }

  const backend: AlarmBackend = {
    kind: 'native',
    capabilities: CAPABILITIES,

    init(): Promise<void> {
      if (!initPromise) {
        initPromise = registerListeners().catch((err: unknown) => {
          initPromise = null; // allow a retry
          throw err;
        });
      }
      return initPromise;
    },

    async sync(alarms: readonly Alarm[], settings: Settings): Promise<SyncResult> {
      const r = await Rouse.syncAlarms({
        mirrorVersion: NATIVE_MIRROR_VERSION,
        alarms: [...alarms],
        settings: toNativeSettings(settings),
      });
      return { next: r.next ?? null, alarms: r.alarms ?? [], bedtimeReminderAt: r.bedtimeReminderAt ?? null };
    },

    async getNextFire(): Promise<NextFire | null> {
      return (await Rouse.getNextFire()).next ?? null;
    },

    getHealth(): Promise<HealthStatus> {
      return Rouse.getHealth();
    },

    async requestFix(id: HealthCheckId): Promise<FixOutcome> {
      return (await Rouse.requestFix({ id })).outcome;
    },

    testAlarm(alarm: Alarm, delaySeconds: number): Promise<{ fireAt: EpochMs }> {
      return Rouse.testAlarm({ alarm, delaySeconds });
    },

    async getPendingTest(): Promise<{ fireAt: EpochMs } | null> {
      const fireAt = (await Rouse.getPendingTest()).fireAt;
      return fireAt == null ? null : { fireAt };
    },

    cancelTest(): Promise<void> {
      return Rouse.cancelTest();
    },

    async getActiveRing(): Promise<ActiveRing | null> {
      return (await Rouse.getActiveRing()).ring ?? null;
    },

    missionUiReady(sessionId: string): Promise<void> {
      return Rouse.missionUiReady({ sessionId });
    },

    setSilenced(sessionId: string, silenced: boolean, leaseMs: number): Promise<void> {
      const clamped = Math.max(0, Math.min(leaseMs, MAX_SILENCE_LEASE_MS));
      return Rouse.setSilenced({ sessionId, silenced, leaseMs: clamped });
    },

    snooze(sessionId: string): Promise<{ snoozeUntil: EpochMs }> {
      return Rouse.snooze({ sessionId });
    },

    async dismiss(token: DismissToken): Promise<DismissResult> {
      const r = await Rouse.dismiss({ sessionId: token.sessionId, via: token.via });
      return { wakeCheckAt: r.wakeCheckAt ?? null };
    },

    confirmAwake(sessionId: string): Promise<void> {
      return Rouse.confirmAwake({ sessionId });
    },

    releaseLockScreen(): Promise<void> {
      return Rouse.releaseLockScreen();
    },

    async getLog(afterSeq: number): Promise<AlarmLogEvent[]> {
      return (await Rouse.getLog({ afterSeq })).events;
    },

    ackLog(throughSeq: number): Promise<void> {
      return Rouse.ackLog({ throughSeq });
    },

    async listSounds(): Promise<SoundInfo[]> {
      return (await Rouse.listSounds()).sounds;
    },

    previewSound(sound: SoundRef, volume: number): Promise<void> {
      return Rouse.previewSound({ sound, volume });
    },

    stopPreview(): Promise<void> {
      return Rouse.stopPreview();
    },

    async pickCustomSound(): Promise<SoundInfo | null> {
      return (await Rouse.pickCustomSound()).sound ?? null;
    },

    deleteCustomSound(id: string): Promise<void> {
      return Rouse.deleteCustomSound({ id });
    },

    async getDiagnostics(): Promise<string> {
      // Each source is read on its own: a failing one is reported, the rest still make the report.
      const unavailable: string[] = [];
      const read = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await fn();
        } catch {
          unavailable.push(name);
          return fallback;
        }
      };
      const [health, next, pending, ring, lines] = await Promise.all([
        read<HealthStatus | null>('health', () => Rouse.getHealth(), null),
        read<NextFire | null>('scheduled', () => backend.getNextFire(), null),
        read<{ fireAt: EpochMs } | null>('pending test', () => backend.getPendingTest(), null),
        read<ActiveRing | null>('episode', () => backend.getActiveRing(), null),
        read<string[]>('log', () => getNativeDiagnostics(), []),
      ]);
      return formatDiagnostics({
        platform: 'android',
        generatedAt: Date.now(),
        health,
        next,
        ring,
        pendingTestAt: pending?.fireAt ?? null,
        lines,
        unavailable,
      });
    },

    subscribe(listener: BackendListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return backend;
}

/** "Copy diagnostics" lines from the native ring buffer (not part of AlarmBackend). */
export async function getNativeDiagnostics(): Promise<string[]> {
  return (await Rouse.getDiagnostics()).lines;
}
