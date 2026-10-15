/**
 * Tap-targets mission engine. OWNER: core agent. API is part of the contract.
 * Targets are shown ONE at a time in order; each must be tapped within ttlMs or it moves (counts
 * as a miss, not a failure). Positions avoid the top 15% (clock) and keep ≥0.25 distance from the previous.
 */
import type { TapMissionConfig } from '../core/types';
import type { Rng } from './rng';
import { notImplemented } from '../core/notImplemented';

export interface TapTarget {
  id: number;
  /** Centre, as fractions 0..1 of the play area. */
  x: number;
  y: number;
  /** Radius as a fraction of min(width, height); rendered ≥ 48 CSS px. */
  radius: number;
  /** Time before the target relocates. */
  ttlMs: number;
}

export function generateTapTargets(config: TapMissionConfig, rng: Rng): TapTarget[] {
  return notImplemented(`generateTapTargets(${config.targets}, ${typeof rng})`);
}

/** Hit test with 20% radius tolerance; all values in the same fractional coordinate space. */
export function isHit(target: TapTarget, x: number, y: number, aspect: number): boolean {
  return notImplemented(`isHit(${target.id}, ${x}, ${y}, ${aspect})`);
}
