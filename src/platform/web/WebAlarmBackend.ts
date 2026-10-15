/**
 * WebAlarmBackend — OWNER: UI agent. STUB: replace the body, keep the export signature.
 * Demo/e2e implementation of AlarmBackend: setTimeout scheduling (re-armed on visibility/
 * focus and every 30 s against Date.now(), so page.clock in Playwright drives it),
 * WebAudio synthesis of BUNDLED_SOUNDS recipes, Notification API best-effort, state in
 * localStorage ('rouse.web.backend') so a reload mid-ring keeps ringing (mirrors the native
 * safety re-ring). Uses core/schedule.ts for next-fire math (it IS the TS algorithm).
 */
import type { AlarmBackend } from '../AlarmBackend';
import type { EpochMs } from '../../core/types';
import { notImplemented } from '../../core/notImplemented';

export interface WebAlarmBackendOptions {
  /** Install window.__rouseTest (RouseTestHooks). */
  testHooks?: boolean;
  /** Injectable clock for unit tests. Default Date.now. */
  now?: () => EpochMs;
  /** Injectable storage for unit tests. Default window.localStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export function createWebAlarmBackend(options: WebAlarmBackendOptions = {}): AlarmBackend {
  return notImplemented(`createWebAlarmBackend(${JSON.stringify(options)})`);
}
