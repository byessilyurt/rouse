/**
 * Seedable randomness for missions. OWNER: core agent. API is part of the contract.
 * Missions take an Rng so tests are deterministic. Production seeds from crypto.getRandomValues.
 */

/** Returns a float in [0, 1). */
export type Rng = () => number;

/** Deterministic PRNG (mulberry32). */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Non-deterministic Rng seeded from crypto.getRandomValues. */
export function randomRng(): Rng {
  const buf = new Uint32Array(1);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(buf);
  } else {
    // No Web Crypto (very old engine): still non-deterministic, just not cryptographic.
    buf[0] = Math.floor(Math.random() * 4294967296) ^ Date.now();
  }
  return createRng(buf[0] ?? 0);
}

/** Integer in [min, max] inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
    throw new RangeError(`randInt: empty range [${min}, ${max}]`);
  }
  // Guard against an Rng that returns exactly 1 (contract says [0, 1), but be defensive).
  return Math.min(hi, lo + Math.floor(rng() * (hi - lo + 1)));
}

/** Uniform pick; throws on empty input. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick: empty list');
  return items[randInt(rng, 0, items.length - 1)] as T;
}

/** New shuffled array (Fisher–Yates). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
