import { describe, expect, it } from 'vitest';
import { GRAVITY, SHAKE_THRESHOLDS, createShakeDetector, createSquatDetector, createStepDetector } from '../../../src/missions/motion';
import type { MotionSample } from '../../../src/missions/motion';
import { createRng } from '../../../src/missions/rng';
import { feed, shaking, squats, walking } from './motionSignals';

const still = (t: number): MotionSample => ({ t, x: 0, y: GRAVITY, z: 0 });

describe('shake detector', () => {
  it('counts one shake per spike above the threshold', () => {
    const d = createShakeDetector('medium');
    const samples: MotionSample[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = i * 400;
      samples.push(still(t0), { t: t0 + 20, x: 20, y: GRAVITY + 10, z: 5 }, { t: t0 + 40, x: 22, y: GRAVITY + 12, z: 5 }, still(t0 + 60));
    }
    expect(feed(d, samples)).toBe(5);
    expect(d.count).toBe(5);
  });

  it('enforces the 250 ms refractory period and re-arm hysteresis', () => {
    const d = createShakeDetector('low');
    const spike = (t: number): MotionSample => ({ t, x: 0, y: GRAVITY + 20, z: 0 });
    expect(d.push(spike(0))).toBe(1);
    expect(d.push(still(50))).toBe(0);
    expect(d.push(spike(100))).toBe(0); // within 250 ms
    expect(d.push(still(260))).toBe(0);
    expect(d.push(spike(300))).toBe(1);
    expect(d.push(spike(600))).toBe(0); // never dropped below half the threshold: still the same shake
  });

  it('presets order: stronger presets need bigger spikes', () => {
    expect(SHAKE_THRESHOLDS.low).toBeLessThan(SHAKE_THRESHOLDS.medium);
    expect(SHAKE_THRESHOLDS.medium).toBeLessThan(SHAKE_THRESHOLDS.high);
    const spike: MotionSample = { t: 0, x: 0, y: GRAVITY + 15, z: 0 };
    expect(createShakeDetector('low').push(spike)).toBe(1);
    expect(createShakeDetector('medium').push(spike)).toBe(0);
    expect(createShakeDetector('high').push({ ...spike, y: GRAVITY + 21 })).toBe(0);
  });

  it('vigorous shaking counts many; walking counts none', () => {
    expect(feed(createShakeDetector('medium'), shaking({ durationMs: 10_000, sampleHz: 60, amp: 25, rng: createRng(1) }))).toBeGreaterThan(15);
    expect(feed(createShakeDetector('low'), walking({ stepHz: 1.8, durationMs: 20_000, sampleHz: 60, rng: createRng(3) }))).toBe(0);
  });

  it('skips null/NaN axes and non-monotonic timestamps; reset clears the count', () => {
    const d = createShakeDetector('low');
    expect(d.push({ t: 0, x: Number.NaN, y: 99, z: 0 })).toBe(0);
    expect(d.push({ t: 0, x: null as unknown as number, y: 99, z: 0 })).toBe(0);
    expect(d.push({ t: 10, x: 0, y: GRAVITY + 20, z: 0 })).toBe(1);
    expect(d.push({ t: 5, x: 0, y: GRAVITY + 20, z: 0 })).toBe(0);
    d.reset();
    expect(d.count).toBe(0);
    expect(d.push({ t: 1, x: 0, y: GRAVITY + 20, z: 0 })).toBe(1);
  });
});

describe('step detector', () => {
  it.each([15, 30, 60, 120])('walking at 1.8 Hz counts the steps (%i Hz sampling, jittered)', (hz) => {
    const d = createStepDetector();
    const n = feed(d, walking({ stepHz: 1.8, durationMs: 20_000, sampleHz: hz, rng: createRng(hz) }));
    expect(n).toBeGreaterThanOrEqual(33); // 36 steps in 20 s
    expect(n).toBeLessThanOrEqual(37);
    expect(d.count).toBe(n);
  });

  it.each([1.4, 2.3])('walking at %f Hz', (stepHz) => {
    const expected = stepHz * 20;
    const n = feed(createStepDetector(), walking({ stepHz, durationMs: 20_000, sampleHz: 50, rng: createRng(9) }));
    expect(n).toBeGreaterThanOrEqual(expected - 3);
    expect(n).toBeLessThanOrEqual(expected + 1);
  });

  it('the first steps are released together once the cadence is confirmed', () => {
    const d = createStepDetector();
    const results = walking({ stepHz: 1.8, durationMs: 5_000, sampleHz: 60, rng: createRng(4), noise: 0 }).map((s) => d.push(s)).filter((r) => r > 0);
    expect(results[0]).toBe(4);
    expect(results.slice(1).every((r) => r === 1)).toBe(true);
  });

  it.each([5, 10, 15, 25])('vigorous random shaking (amp %i) does not count beyond a small tolerance', (amp) => {
    for (let seed = 0; seed < 8; seed++) {
      for (const hz of [30, 60]) {
        const n = feed(createStepDetector(), shaking({ durationMs: 30_000, sampleHz: hz, amp, rng: createRng(seed * 100 + amp) }));
        expect(n).toBeLessThanOrEqual(8); // vs ~54 steps for 30 s of walking
      }
    }
  });

  it('shaking in the middle of a walk stops counting, and walking resumes counting afterwards', () => {
    const rng = createRng(11);
    const samples = [
      ...walking({ stepHz: 1.8, durationMs: 10_000, sampleHz: 60, rng }),
      ...shaking({ durationMs: 10_000, sampleHz: 60, amp: 20, rng, t0: 10_000 }),
      ...walking({ stepHz: 1.8, durationMs: 10_000, sampleHz: 60, rng, t0: 20_000 }),
    ];
    const n = feed(createStepDetector(), samples);
    expect(n).toBeGreaterThanOrEqual(32);
    expect(n).toBeLessThanOrEqual(42);
  });

  it('standing still counts nothing; a stalled stream restarts the filter', () => {
    const d = createStepDetector();
    const rng = createRng(2);
    const quiet = Array.from({ length: 600 }, (_, i) => ({ t: i * 16, x: 0.05 * (rng() - 0.5), y: GRAVITY + 0.1 * (rng() - 0.5), z: 0 }));
    expect(feed(d, quiet)).toBe(0);
    const after = walking({ stepHz: 1.8, durationMs: 10_000, sampleHz: 60, rng, t0: 30_000 });
    expect(feed(d, after)).toBeGreaterThanOrEqual(15);
    d.reset();
    expect(d.count).toBe(0);
  });

  it('irregular sample input is skipped', () => {
    const d = createStepDetector();
    expect(d.push({ t: 0, x: 0, y: Number.NaN, z: 0 })).toBe(0);
    expect(d.push({ t: 1, x: 0, y: GRAVITY, z: 0 })).toBe(0);
    expect(d.push({ t: 1, x: 0, y: GRAVITY, z: 0 })).toBe(0);
  });
});

describe('squat detector', () => {
  it.each([
    [1500, 30],
    [2200, 60],
    [3000, 120],
    [2000, 15],
  ])('counts squat cycles (period %i ms, %i Hz)', (periodMs, hz) => {
    const n = feed(createSquatDetector(), squats({ reps: 10, periodMs, sampleHz: hz, rng: createRng(periodMs + hz) }));
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(10);
  });

  it('back-to-back squats without a pause still count each one', () => {
    const n = feed(createSquatDetector(), squats({ reps: 8, periodMs: 2000, pauseMs: 0, sampleHz: 60, rng: createRng(5) }));
    expect(n).toBeGreaterThanOrEqual(7);
    expect(n).toBeLessThanOrEqual(8);
  });

  it('fast jiggles (< 0.8 s) and standing still are not squats', () => {
    expect(feed(createSquatDetector(), squats({ reps: 10, periodMs: 400, sampleHz: 60, depthM: 0.05, rng: createRng(1) }))).toBe(0);
    const still = Array.from({ length: 600 }, (_, i) => ({ t: i * 16, x: 0.5, y: 9.3, z: 3 }));
    expect(feed(createSquatDetector(), still)).toBe(0);
  });

  it('random shaking and walking produce few squats', () => {
    expect(feed(createSquatDetector(), shaking({ durationMs: 30_000, sampleHz: 60, amp: 15, rng: createRng(3) }))).toBeLessThanOrEqual(4);
    expect(feed(createSquatDetector(), walking({ stepHz: 1.8, durationMs: 20_000, sampleHz: 60, rng: createRng(3) }))).toBeLessThanOrEqual(3);
  });

  it('reset, gaps and bad samples', () => {
    const d = createSquatDetector();
    expect(d.push({ t: 0, x: 0, y: Number.POSITIVE_INFINITY, z: 0 })).toBe(0);
    feed(d, squats({ reps: 3, periodMs: 2000, sampleHz: 60, rng: createRng(8) }));
    expect(d.count).toBeGreaterThan(0);
    d.reset();
    expect(d.count).toBe(0);
    expect(d.push({ t: 0, x: 0, y: 0, z: 0 })).toBe(0); // zero vector (free fall) is skipped safely
    expect(d.push({ t: 10, x: 0, y: 0, z: 0 })).toBe(0);
  });
});
