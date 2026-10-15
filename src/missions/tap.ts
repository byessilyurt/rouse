/**
 * Tap-targets mission engine. OWNER: core agent. API is part of the contract.
 * Targets are shown ONE at a time in order; each must be tapped within ttlMs or it moves (counts
 * as a miss, not a failure). Positions avoid the top 15% (clock) and keep ≥0.25 distance from the previous.
 */
import type { TapMissionConfig } from '../core/types';
import { LIMITS } from '../core/defaults';
import type { Rng } from './rng';

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

export const TAP_TARGET_RADIUS = 0.1;
export const TAP_TARGET_TTL_MS = 3000;
/** Top band reserved for the clock / counter. */
export const TAP_TOP_EXCLUDED = 0.15;
export const TAP_MIN_DISTANCE = 0.25;
/** Hit tolerance: a tap within radius × 1.2 counts. */
export const TAP_HIT_TOLERANCE = 1.2;

/**
 * Centres stay this far from every edge. Because the radius is a fraction of the SHORTER side,
 * a margin larger than the radius keeps the whole circle inside the area for any aspect ratio.
 */
const EDGE_MARGIN = 0.12;
const X_MIN = EDGE_MARGIN;
const X_MAX = 1 - EDGE_MARGIN;
const Y_MIN = TAP_TOP_EXCLUDED + EDGE_MARGIN;
const Y_MAX = 1 - EDGE_MARGIN;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

function placeAwayFrom(prev: { x: number; y: number } | null, rng: Rng): { x: number; y: number } {
  const sample = () => ({ x: X_MIN + rng() * (X_MAX - X_MIN), y: Y_MIN + rng() * (Y_MAX - Y_MIN) });
  if (!prev) return sample();
  for (let attempt = 0; attempt < 50; attempt++) {
    const p = sample();
    if (Math.hypot(p.x - prev.x, p.y - prev.y) >= TAP_MIN_DISTANCE) return p;
  }
  // Practically unreachable; the opposite corner is always ≥ 0.38 away.
  return { x: prev.x < 0.5 ? X_MAX : X_MIN, y: prev.y < (Y_MIN + Y_MAX) / 2 ? Y_MAX : Y_MIN };
}

export function generateTapTargets(config: TapMissionConfig, rng: Rng): TapTarget[] {
  const raw = Number.isFinite(config.targets) ? Math.round(config.targets) : LIMITS.tap.targets.min;
  const count = Math.min(LIMITS.tap.targets.max, Math.max(LIMITS.tap.targets.min, raw));
  const out: TapTarget[] = [];
  let prev: { x: number; y: number } | null = null;
  for (let id = 0; id < count; id++) {
    let p = placeAwayFrom(prev, rng);
    p = { x: round3(p.x), y: round3(p.y) };
    // Rounding can shave a hair off the distance; nudge back to the guaranteed corner if so.
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < TAP_MIN_DISTANCE) {
      p = { x: prev.x < 0.5 ? X_MAX : X_MIN, y: prev.y < (Y_MIN + Y_MAX) / 2 ? Y_MAX : Y_MIN };
    }
    out.push({ id, x: p.x, y: p.y, radius: TAP_TARGET_RADIUS, ttlMs: TAP_TARGET_TTL_MS });
    prev = p;
  }
  return out;
}

/**
 * Hit test with 20% radius tolerance; all values in the same fractional coordinate space.
 * `aspect` = play-area width / height, used to measure the distance in real (isotropic) units.
 */
export function isHit(target: TapTarget, x: number, y: number, aspect: number): boolean {
  if (![x, y, aspect].every(Number.isFinite) || aspect <= 0) return false;
  // Work in units of the play-area HEIGHT: a horizontal fraction spans `aspect` heights.
  const dx = (x - target.x) * aspect;
  const dy = y - target.y;
  const radius = target.radius * Math.min(aspect, 1) * TAP_HIT_TOLERANCE;
  return dx * dx + dy * dy <= radius * radius;
}
