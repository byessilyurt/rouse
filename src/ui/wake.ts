/**
 * The wake level (docs/design-language.md §1.1): one number 0–1 that drives type weight and width, colour
 * temperature and contrast. Screens with a fixed level (ringing, missions, snoozed…) claim it with useWake();
 * otherwise it follows the local time of day.
 */
import { useEffect } from 'preact/hooks';

/** [minute of day, wake] knots, linear in between; wraps at midnight. */
const KNOTS: readonly [number, number][] = [
  [0, 0.22],
  [60, 0.15],
  [270, 0.15],
  [480, 0.65],
  [600, 0.7],
  [1140, 0.7],
  [1380, 0.3],
  [1440, 0.22],
];

export function circadianWake(date: Date): number {
  const m = date.getHours() * 60 + date.getMinutes();
  for (let i = 1; i < KNOTS.length; i++) {
    const [m1, w1] = KNOTS[i]!;
    const [m0, w0] = KNOTS[i - 1]!;
    if (m <= m1) return w0 + ((w1 - w0) * (m - m0)) / (m1 - m0);
  }
  return KNOTS[0]![1];
}

/** Mission wake: 0.55 rising evenly to 0.95 as `solved` of `total` missions are done. */
export function missionWake(solved: number, total: number): number {
  if (total <= 0) return 0.95;
  return 0.55 + (0.4 * Math.min(Math.max(solved, 0), total)) / total;
}

export const WAKE = { snoozed: 0.15, ringing: 1, fallback: 0.6, wakeCheck: 0.8, done: 1 } as const;

let override: number | null = null;
const listeners = new Set<() => void>();

export function getWakeOverride(): number | null {
  return override;
}

export function subscribeWake(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function setOverride(v: number | null) {
  if (override === v) return;
  override = v;
  for (const l of [...listeners]) l();
}

/** Pin the wake level while the calling screen is mounted (null = follow the time of day). */
export function useWake(level: number | null): void {
  useEffect(() => {
    setOverride(level === null ? null : Math.min(1, Math.max(0, level)));
    return () => setOverride(null);
  }, [level]);
}

/** Turn the whole page into the ring signal colour while `on` (design-language.md §5.3). */
export function useSignal(on: boolean): void {
  useEffect(() => {
    if (!on) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-signal', '1');
    return () => root.removeAttribute('data-signal');
  }, [on]);
}
