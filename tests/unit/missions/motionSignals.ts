/** Synthetic accelerometer signals for motion-detector tests (not a test file itself). */
import type { MotionSample, RepDetector } from '../../../src/missions/motion';
import { GRAVITY } from '../../../src/missions/motion';
import type { Rng } from '../../../src/missions/rng';

/** Gaussian noise via Box–Muller. */
export function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Sample times over `durationMs` at `hz`, with ±jitter fraction of the period. */
export function times(durationMs: number, hz: number, rng: Rng, jitter = 0.3): number[] {
  const out: number[] = [];
  const period = 1000 / hz;
  for (let t = 0; t < durationMs; ) {
    out.push(t);
    t += period * (1 + (rng() * 2 - 1) * jitter);
  }
  return out;
}

/** Phone held in hand (tilted), walking: vertical bounce at the step rate plus a lateral sway at half the rate. */
export function walking(opts: { stepHz: number; durationMs: number; sampleHz: number; amp?: number; noise?: number; rng: Rng; t0?: number }): MotionSample[] {
  const { stepHz, durationMs, sampleHz, rng } = opts;
  const amp = opts.amp ?? 2.5;
  const noise = opts.noise ?? 0.3;
  const t0 = opts.t0 ?? 0;
  // Gravity direction for a phone held at ~40° from vertical.
  const tilt = (40 * Math.PI) / 180;
  const up = { x: 0, y: Math.cos(tilt), z: Math.sin(tilt) };
  return times(durationMs, sampleHz, rng).map((t) => {
    const s = t / 1000;
    const vertical = amp * Math.sin(2 * Math.PI * stepHz * s) + 0.4 * amp * Math.sin(4 * Math.PI * stepHz * s + 1);
    const sway = 0.6 * Math.sin(Math.PI * stepHz * s);
    const g = GRAVITY + vertical;
    return {
      t: t0 + t,
      x: sway + noise * gauss(rng),
      y: up.y * g + noise * gauss(rng),
      z: up.z * g + noise * gauss(rng),
    };
  });
}

/** Vigorous random shaking: band-limited random acceleration on every axis. */
export function shaking(opts: { durationMs: number; sampleHz: number; amp?: number; rng: Rng; t0?: number }): MotionSample[] {
  const { durationMs, sampleHz, rng } = opts;
  const amp = opts.amp ?? 15;
  const t0 = opts.t0 ?? 0;
  // Sum of a few random-frequency (3–9 Hz) sinusoids per axis, re-randomised every ~0.5 s.
  type Osc = { f: number; p: number; a: number };
  const newOscs = (): Osc[][] => [0, 1, 2].map(() => [0, 1, 2].map(() => ({ f: 3 + rng() * 6, p: rng() * 2 * Math.PI, a: amp * (0.3 + rng() * 0.7) })));
  let oscs = newOscs();
  let nextChange = 500;
  return times(durationMs, sampleHz, rng).map((t) => {
    if (t >= nextChange) {
      oscs = newOscs();
      nextChange += 300 + rng() * 400;
    }
    const s = t / 1000;
    const axis = (i: number) => (oscs[i] as Osc[]).reduce((sum, o) => sum + o.a * Math.sin(2 * Math.PI * o.f * s + o.p), 0) / 2;
    return { t: t0 + t, x: axis(0), y: GRAVITY + axis(1), z: axis(2) };
  });
}

/** Squats with the phone at the chest: vertical displacement −A(1−cos)/2 per rep of `periodMs`, pauses between. */
export function squats(opts: { reps: number; periodMs: number; pauseMs?: number; depthM?: number; sampleHz: number; rng: Rng; noise?: number }): MotionSample[] {
  const { reps, periodMs, sampleHz, rng } = opts;
  const pause = opts.pauseMs ?? 300;
  const depth = opts.depthM ?? 0.45;
  const noise = opts.noise ?? 0.15;
  const total = 1000 + reps * (periodMs + pause) + 1000;
  const w = (2 * Math.PI) / (periodMs / 1000);
  // Phone upright-ish at the chest: gravity mostly along +y.
  return times(total, sampleHz, rng).map((t) => {
    let a = 0;
    const local = t - 1000;
    if (local >= 0) {
      const k = Math.floor(local / (periodMs + pause));
      const within = local - k * (periodMs + pause);
      if (k < reps && within < periodMs) a = -(depth / 2) * w * w * Math.cos((w * within) / 1000);
    }
    const g = GRAVITY + a;
    return { t, x: 0.5 + noise * gauss(rng), y: 0.95 * g + noise * gauss(rng), z: 0.31 * g + noise * gauss(rng) };
  });
}

export function feed(detector: RepDetector, samples: readonly MotionSample[]): number {
  let reps = 0;
  for (const s of samples) reps += detector.push(s);
  return reps;
}
