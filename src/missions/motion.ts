/**
 * Motion-based rep detectors for shake / steps / squat. OWNER: core agent. API is part of the contract.
 * Pure: the UI feeds samples from `devicemotion` events (accelerationIncludingGravity, e.timeStamp).
 * Detectors must tolerate irregular sample rates (15–120 Hz) and null axes (skip the sample).
 */
import type { ShakeMissionConfig } from '../core/types';

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

/** Standard gravity, m/s². */
export const GRAVITY = 9.80665;

/** A gap longer than this (tab hidden, sensor paused) restarts filters instead of bridging it. */
const MAX_SAMPLE_GAP_MS = 1000;

/** Samples with a missing axis (null → NaN) or a non-monotonic timestamp are skipped. */
function isUsable(s: MotionSample, lastT: number | null): boolean {
  if (![s.t, s.x, s.y, s.z].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  return lastT === null || s.t > lastT;
}

const magnitude = (s: MotionSample): number => Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);

/** Exponential smoothing factor for time constant `tauMs` over a step of `dtMs` (rate-independent). */
const smoothing = (dtMs: number, tauMs: number): number => 1 - Math.exp(-dtMs / tauMs);

// ─────────────────────────────────────────────────────────────────────────────
// Shake
// ─────────────────────────────────────────────────────────────────────────────

/** Deviation of |a| from g needed for one shake, per preset. */
export const SHAKE_THRESHOLDS: Readonly<Record<ShakeMissionConfig['sensitivity'], number>> = { low: 13, medium: 17, high: 22 };
export const SHAKE_REFRACTORY_MS = 250;
/** The deviation must fall below this fraction of the threshold before the next shake can count. */
const SHAKE_REARM_FRACTION = 0.5;

/** Shake = magnitude spike above threshold (low 13 / medium 17 / high 22 m/s² deviation from g), ≥250 ms refractory. */
export function createShakeDetector(sensitivity: ShakeMissionConfig['sensitivity']): RepDetector {
  const threshold = SHAKE_THRESHOLDS[sensitivity] ?? SHAKE_THRESHOLDS.medium;
  let count = 0;
  let lastT: number | null = null;
  let lastShakeT = -Infinity;
  let armed = true;

  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
      lastT = null;
      lastShakeT = -Infinity;
      armed = true;
    },
    push(s) {
      if (!isUsable(s, lastT)) return 0;
      lastT = s.t;
      const deviation = Math.abs(magnitude(s) - GRAVITY);
      if (!armed) {
        if (deviation < threshold * SHAKE_REARM_FRACTION) armed = true;
        return 0;
      }
      if (deviation >= threshold && s.t - lastShakeT >= SHAKE_REFRACTORY_MS) {
        count++;
        lastShakeT = s.t;
        armed = false;
        return 1;
      }
      return 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────────────

export const STEP_MIN_INTERVAL_MS = 300;
export const STEP_MAX_INTERVAL_MS = 2000;
export const STEP_MIN_AMPLITUDE = 1.2;
export const STEP_MAX_AMPLITUDE = 12;
/** A candidate step whose interval differs from the running median by more than this is not a step. */
export const STEP_CADENCE_TOLERANCE = 0.4;
/** Steps held back until this many peaks in a row show a regular cadence (then all are counted). */
export const STEP_CONFIRM_COUNT = 4;
/** Low-pass time constant (~3 Hz cut-off): walking (1.4–2.5 Hz) passes, shaking (4+ Hz) is damped. */
const STEP_LOWPASS_TAU_MS = 53;
/** Peak/trough hysteresis on the filtered magnitude, m/s². */
const STEP_HYSTERESIS = 0.5;
/** Any raw sample this far from g within a step cycle means the phone is being shaken, not carried. */
const STEP_RAW_SHAKE_LIMIT = 15;
const STEP_HISTORY = 6;

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * Step = peak in low-pass-filtered magnitude, 0.3–2 s apart, amplitude 1.2–12 m/s².
 * Anti-shake: peaks whose cadence varies >40% from the running median, or amplitude >12, are ignored;
 * the first 4 steps are only counted once a regular cadence is confirmed.
 */
export function createStepDetector(): RepDetector {
  let count = 0;
  let lastT: number | null = null;
  let filtered = 0;
  // Extremum tracking on the filtered signal.
  let seeking: 'peak' | 'trough' = 'peak';
  let extreme = 0;
  let extremeT = 0;
  let lastTrough: number | null = null;
  let rawMaxDeviation = 0;
  // Cadence state.
  let lastPeakT: number | null = null;
  let intervals: number[] = [];
  let pending = 0;
  let confirmed = false;

  const restartCadence = (peakT: number | null): void => {
    lastPeakT = peakT;
    intervals = [];
    pending = peakT === null ? 0 : 1;
    confirmed = false;
  };

  const reset = (): void => {
    count = 0;
    lastT = null;
    filtered = 0;
    seeking = 'peak';
    extreme = 0;
    extremeT = 0;
    lastTrough = null;
    rawMaxDeviation = 0;
    restartCadence(null);
  };

  /** A filtered peak was confirmed at time t with the given peak-to-trough amplitude. */
  const onPeak = (t: number, amplitude: number, shaken: boolean): number => {
    if (amplitude < STEP_MIN_AMPLITUDE) return 0; // a wobble, not a step: ignore entirely
    if (amplitude > STEP_MAX_AMPLITUDE || shaken) {
      restartCadence(null); // violent motion: whatever was building up is not walking
      return 0;
    }
    if (lastPeakT === null) {
      restartCadence(t);
      return 0;
    }
    const interval = t - lastPeakT;
    if (interval < STEP_MIN_INTERVAL_MS) {
      restartCadence(null); // faster than anyone walks: shaking
      return 0;
    }
    if (interval > STEP_MAX_INTERVAL_MS) {
      restartCadence(t); // a pause: this peak may start a new walk
      return 0;
    }
    const regular = intervals.length === 0 || Math.abs(interval - median(intervals)) <= STEP_CADENCE_TOLERANCE * median(intervals);
    intervals.push(interval);
    if (intervals.length > STEP_HISTORY) intervals.shift();
    lastPeakT = t;
    if (!regular) {
      // Keep only this interval's peak as the possible start of a new regular run.
      intervals = [interval];
      pending = 1;
      confirmed = false;
      return 0;
    }
    if (confirmed) {
      count++;
      return 1;
    }
    pending++;
    if (pending >= STEP_CONFIRM_COUNT) {
      const released = pending;
      count += released;
      pending = 0;
      confirmed = true;
      return released;
    }
    return 0;
  };

  reset();
  return {
    get count() {
      return count;
    },
    reset,
    push(s) {
      if (!isUsable(s, lastT)) return 0;
      const mag = magnitude(s);
      const dt = lastT === null ? Infinity : s.t - lastT;
      lastT = s.t;
      if (dt > MAX_SAMPLE_GAP_MS) {
        // First sample, or the stream stalled: restart the filter at the current value.
        filtered = mag;
        seeking = 'peak';
        extreme = mag;
        extremeT = s.t;
        lastTrough = null;
        rawMaxDeviation = 0;
        if (dt !== Infinity) restartCadence(null);
        return 0;
      }
      filtered += smoothing(dt, STEP_LOWPASS_TAU_MS) * (mag - filtered);
      rawMaxDeviation = Math.max(rawMaxDeviation, Math.abs(mag - GRAVITY));

      if (seeking === 'peak') {
        if (filtered > extreme) {
          extreme = filtered;
          extremeT = s.t;
        } else if (filtered < extreme - STEP_HYSTERESIS) {
          const amplitude = lastTrough === null ? 0 : extreme - lastTrough;
          const shaken = rawMaxDeviation > STEP_RAW_SHAKE_LIMIT;
          const reps = lastTrough === null ? 0 : onPeak(extremeT, amplitude, shaken);
          seeking = 'trough';
          extreme = filtered;
          extremeT = s.t;
          rawMaxDeviation = 0;
          return reps;
        }
      } else if (filtered < extreme) {
        extreme = filtered;
        extremeT = s.t;
      } else if (filtered > extreme + STEP_HYSTERESIS) {
        lastTrough = extreme;
        seeking = 'peak';
        extreme = filtered;
        extremeT = s.t;
      }
      return 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Squats
// ─────────────────────────────────────────────────────────────────────────────

export const SQUAT_MIN_DURATION_MS = 800;
export const SQUAT_MAX_DURATION_MS = 4000;
/** Vertical acceleration (m/s², gravity removed) that marks the "going down" and "coming up" phases. */
export const SQUAT_THRESHOLD = 0.7;
/** Gravity direction estimate: slow enough that a 1–3 s squat barely moves it. */
const SQUAT_GRAVITY_TAU_MS = 2500;
/** Light smoothing of the vertical signal against hand tremor. */
const SQUAT_SIGNAL_TAU_MS = 80;
/** The "up" phase ends when the vertical signal falls back below this fraction of the threshold. */
const SQUAT_END_FRACTION = 0.3;

/** Squat = down-then-up cycle of vertical (gravity-projected) acceleration lasting 0.8–4 s. Honestly cheatable. */
export function createSquatDetector(): RepDetector {
  let count = 0;
  let lastT: number | null = null;
  let gx = 0;
  let gy = 0;
  let gz = 0;
  let vertical = 0;
  let phase: 'idle' | 'down' | 'up' = 'idle';
  let cycleStart = 0;

  const reset = (): void => {
    count = 0;
    lastT = null;
    vertical = 0;
    phase = 'idle';
    cycleStart = 0;
  };

  return {
    get count() {
      return count;
    },
    reset,
    push(s) {
      if (!isUsable(s, lastT)) return 0;
      const dt = lastT === null ? Infinity : s.t - lastT;
      lastT = s.t;
      if (dt > MAX_SAMPLE_GAP_MS) {
        gx = s.x;
        gy = s.y;
        gz = s.z;
        vertical = 0;
        phase = 'idle';
        return 0;
      }
      const kg = smoothing(dt, SQUAT_GRAVITY_TAU_MS);
      gx += kg * (s.x - gx);
      gy += kg * (s.y - gy);
      gz += kg * (s.z - gz);
      const gLen = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (gLen < 1e-6) return 0;
      // Upward-positive vertical acceleration: projection onto the gravity direction, minus g.
      const raw = (s.x * gx + s.y * gy + s.z * gz) / gLen - gLen;
      vertical += smoothing(dt, SQUAT_SIGNAL_TAU_MS) * (raw - vertical);

      switch (phase) {
        case 'idle':
          if (vertical < -SQUAT_THRESHOLD) {
            phase = 'down';
            cycleStart = s.t;
          }
          return 0;
        case 'down':
          if (s.t - cycleStart > SQUAT_MAX_DURATION_MS) {
            phase = vertical < -SQUAT_THRESHOLD ? 'down' : 'idle';
            cycleStart = s.t;
          } else if (vertical > SQUAT_THRESHOLD) {
            phase = 'up';
          }
          return 0;
        case 'up': {
          if (vertical >= SQUAT_THRESHOLD * SQUAT_END_FRACTION) {
            if (s.t - cycleStart > SQUAT_MAX_DURATION_MS) phase = 'idle';
            return 0;
          }
          const duration = s.t - cycleStart;
          // The deceleration at the top of this squat may already be the start of the next one.
          phase = vertical < -SQUAT_THRESHOLD ? 'down' : 'idle';
          cycleStart = s.t;
          if (duration >= SQUAT_MIN_DURATION_MS && duration <= SQUAT_MAX_DURATION_MS) {
            count++;
            return 1;
          }
          return 0;
        }
      }
    },
  };
}
