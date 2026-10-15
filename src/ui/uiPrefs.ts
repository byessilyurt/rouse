/**
 * Small per-device UI conveniences in localStorage ('rouse.ui'). Never source of truth for alarms;
 * every read/write tolerates storage being unavailable.
 */
import type { EpochMs } from '../core/types';

export interface UiPrefs {
  /** Last test ring that was turned off (Reliability "Test alarm" row). */
  lastTestOkAt: EpochMs | null;
  /** A scheduled health test that never rang. */
  lastTestMissedAt: EpochMs | null;
  /** Pending health test fire time. */
  pendingTestAt: EpochMs | null;
}

const KEY = 'rouse.ui';
const DEFAULTS: UiPrefs = { lastTestOkAt: null, lastTestMissedAt: null, pendingTestAt: null };

export function readUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeUiPrefs(patch: Partial<UiPrefs>): UiPrefs {
  const next = { ...readUiPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
