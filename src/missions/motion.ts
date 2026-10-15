/**
 * Motion-based rep detectors for shake / steps / squat. OWNER: core agent. API is part of the contract.
 * Pure: the UI feeds samples from `devicemotion` events (accelerationIncludingGravity, e.timeStamp).
 * Detectors must tolerate irregular sample rates (15–120 Hz) and null axes (skip the sample).
 */
import type { ShakeMissionConfig } from '../core/types';
import { notImplemented } from '../core/notImplemented';

export interface MotionSample {
  /** Monotonic ms (DeviceMotionEvent.timeStamp or performance.now()). */
  t: number;
  /** Acceleration including gravity, m/s². */
  x: number;
  y: number;
  z: number;
}

export interface RepDetector {
  /** Feed one sample; returns the number of NEW reps detected by it (usually 0 or 1). */
  push(sample: MotionSample): number;
  readonly count: number;
  reset(): void;
}

/** Shake = magnitude spike above threshold (low 13 / medium 17 / high 22 m/s² deviation from g), ≥250 ms refractory. */
export function createShakeDetector(sensitivity: ShakeMissionConfig['sensitivity']): RepDetector {
  return notImplemented(`createShakeDetector(${sensitivity})`);
}

/**
 * Step = peak in low-pass-filtered magnitude, 0.3–2 s apart, amplitude 1.2–12 m/s².
 * Anti-shake: peaks whose cadence varies >40% from the running median, or amplitude >12, are ignored;
 * the first 4 steps are only counted once a regular cadence is confirmed.
 */
export function createStepDetector(): RepDetector {
  return notImplemented('createStepDetector');
}

/** Squat = down-then-up cycle of vertical (gravity-projected) acceleration lasting 0.8–4 s. Honestly cheatable. */
export function createSquatDetector(): RepDetector {
  return notImplemented('createSquatDetector');
}
