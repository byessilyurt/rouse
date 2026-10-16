/**
 * The scheduled-but-not-yet-fired test ring, as the backend reports it (getPendingTest). Shared by the
 * Reliability screen and the alarm editor's Test section so both show "Test alarm in 0:42 · Cancel test".
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { EpochMs } from '../core/types';
import { useApp } from './context';
import { writeUiPrefs } from './uiPrefs';

export interface PendingTest {
  /** Fire time of the pending test, or null when none is pending. */
  fireAt: EpochMs | null;
  refresh: () => Promise<void>;
  /** Cancel the pending test (and end a running test ring). Clears the Reliability "missed test" watch. */
  cancel: () => Promise<void>;
  /** Optimistic update right after scheduling a test. */
  set: (fireAt: EpochMs | null) => void;
}

/** `t` is the caller's ticking clock (useNow); a pending test that has come due is re-read from the backend. */
export function usePendingTest(t: EpochMs): PendingTest {
  const { backend } = useApp();
  const [fireAt, set] = useState<EpochMs | null>(null);
  const refresh = useCallback(async () => {
    try {
      set((await backend.getPendingTest())?.fireAt ?? null);
    } catch {
      set(null);
    }
  }, [backend]);
  useEffect(() => {
    void refresh();
    return backend.subscribe((e) => {
      if (e.type === 'ring' || e.type === 'ring-state') void refresh();
    });
  }, [backend, refresh]);
  useEffect(() => {
    if (fireAt != null && fireAt <= t) void refresh();
  }, [t]);
  const cancel = useCallback(async () => {
    try {
      await backend.cancelTest();
    } finally {
      writeUiPrefs({ pendingTestAt: null });
      set(null);
    }
  }, [backend]);
  return { fireAt, refresh, cancel, set };
}
