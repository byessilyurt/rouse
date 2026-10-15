/**
 * Backend selection — SHARED CONTRACT (trivial; owned by the planner).
 * Native Android → NativeAlarmBackend (real alarms). Anything else → WebAlarmBackend (demo/e2e).
 * Both are loaded lazily so the web bundle never evaluates plugin code paths it can't use.
 */
import { Capacitor } from '@capacitor/core';
import type { AlarmBackend } from './AlarmBackend';

export async function createBackend(): Promise<AlarmBackend> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    const { createNativeAlarmBackend } = await import('./native/NativeAlarmBackend');
    return createNativeAlarmBackend();
  }
  const { createWebAlarmBackend } = await import('./web/WebAlarmBackend');
  return createWebAlarmBackend({ testHooks: /[?&]e2e=1\b/.test(location.search + location.hash) });
}
