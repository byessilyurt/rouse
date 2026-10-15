/**
 * Seedable randomness for missions. OWNER: core agent. API is part of the contract.
 * Missions take an Rng so tests are deterministic. Production seeds from crypto.getRandomValues.
 */
import { notImplemented } from '../core/notImplemented';

/** Returns a float in [0, 1). */
export type Rng = () => number;

/** Deterministic PRNG (mulberry32). */
export function createRng(seed: number): Rng {
  return notImplemented(`createRng(${seed})`);
}

/** Non-deterministic Rng seeded from crypto.getRandomValues. */
export function randomRng(): Rng {
  return notImplemented('randomRng');
}

/** Integer in [min, max] inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  return notImplemented(`randInt(${typeof rng}, ${min}, ${max})`);
}

/** Uniform pick; throws on empty input. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return notImplemented(`pick(${typeof rng}, ${items.length})`);
}

/** New shuffled array (Fisher–Yates). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  return notImplemented(`shuffle(${typeof rng}, ${items.length})`);
}
