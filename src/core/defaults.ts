/**
 * Defaults, limits and mission metadata — SHARED CONTRACT.
 *
 * Constraints (do not break):
 *  - Only `import type` imports. This file is imported by `scripts/gen-sounds.ts`, which runs
 *    under plain Node 22 type-stripping (no bundler, no path resolution for value imports).
 *  - No enums, no namespaces, no parameter properties (not strippable).
 *  - Constants that Java must agree with are marked [JAVA]; the native agent copies the values
 *    into `app.rouse.alarm.RouseConstants`.
 */
import type {
  Alarm,
  AlarmDefaults,
  AlarmId,
  BundledSoundId,
  EpochMs,
  FallbackMissionConfig,
  MissionConfig,
  MissionConfigOf,
  MissionRequirement,
  MissionType,
  Settings,
  SoundRef,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Versions & storage keys
// ─────────────────────────────────────────────────────────────────────────────

/** localStorage key holding PersistedState JSON. */
export const STORAGE_KEY = 'rouse.state';
/** localStorage key prefix for per-session RingSession progress: `${prefix}${sessionId}`. */
export const RING_PROGRESS_KEY_PREFIX = 'rouse.ring.';
export const STORAGE_SCHEMA_VERSION = 1;
export const BACKUP_FORMAT = 'rouse-backup';
export const BACKUP_VERSION = 1;
/** Version of the syncAlarms payload understood by Java. [JAVA] */
export const NATIVE_MIRROR_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_MISSIONS = 3;
export const MAX_LABEL_LENGTH = 60;
export const MAX_CUSTOM_PHRASE_LENGTH = 200;
export const MAX_ALARMS = 50;
/** Wake records kept; oldest dropped first. */
export const MAX_WAKE_RECORDS = 1000;

/** Inclusive numeric ranges used by validation (core) and the editor sliders (UI). */
export const LIMITS = {
  volume: { min: 10, max: 100 },
  volumeRampSec: { min: 0, max: 300 },
  snoozeIntervalMin: { min: 1, max: 60 },
  snoozeMaxCount: { min: 1, max: 10 },
  wakeCheckDelayMin: { min: 1, max: 30 },
  wakeCheckWindowMin: { min: 1, max: 10 },
  silenceWhileSolvingSec: { min: 10, max: 60 },
  fallbackAfterFailures: { min: 1, max: 10 },
  fallbackAfterMinutes: { min: 1, max: 30 },
  sleepGoalMin: { min: 240, max: 720 },
  napMinutes: { min: 5, max: 120 },
  math: { difficulty: { min: 1, max: 5 }, count: { min: 1, max: 20 } },
  memory: { gridSize: { min: 3, max: 5 }, rounds: { min: 1, max: 5 } },
  typing: { phrases: { min: 1, max: 5 } },
  shake: { count: { min: 10, max: 500 } },
  tap: { targets: { min: 5, max: 60 } },
  steps: { count: { min: 10, max: 500 } },
  squat: { count: { min: 5, max: 100 } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Timing constants (ringing pipeline)
// ─────────────────────────────────────────────────────────────────────────────

/** If JS hasn't called missionUiReady this long after the ring UI was launched, native shows its fallback math. [JAVA] */
export const NATIVE_UI_READY_TIMEOUT_MS = 10_000;
/** Re-ring safety alarm period while an episode is 'ringing'. Re-armed on every tick. [JAVA] */
export const SAFETY_RERING_INTERVAL_MS = 60_000;
/** Upper bound for one silence lease; native clamps larger values. [JAVA] */
export const MAX_SILENCE_LEASE_MS = 60_000;
/** RingController renews the silence lease at most this often while the user is active. */
export const SILENCE_RENEW_THROTTLE_MS = 5_000;
/** A fire time that passed less than this long ago (device off / late delivery) still rings ("catch-up"); older = 'missed'. [JAVA] */
export const MISSED_GRACE_MS = 30 * 60_000;
/** Delay used when ringing must start from a context that cannot start the FGS (boot, time change): setAlarmClock(now + this). [JAVA] */
export const DEFERRED_START_DELAY_MS = 5_000;
/** Max wake-check re-rings per episode; after that the episode ends with wakeCheck='failed'. [JAVA] */
export const WAKE_CHECK_MAX_RERINGS = 2;
/** Native fallback (WebView dead): number of math problems, two-digit × one-digit + two-digit. [JAVA] */
export const NATIVE_FALLBACK_PROBLEMS = 5;
/** Native log (AlarmLogEvent queue) cap; oldest acked-or-not events dropped first. [JAVA] */
export const NATIVE_LOG_CAP = 500;
/** Max custom sound file size accepted by pickCustomSound. [JAVA] */
export const MAX_CUSTOM_SOUND_BYTES = 20 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Sounds
// ─────────────────────────────────────────────────────────────────────────────

/** One synthesised note. Times in ms relative to loop start. */
export interface ToneNote {
  startMs: number;
  durMs: number;
  freqHz: number;
  /** If set, frequency sweeps linearly from freqHz to freqEndHz over durMs. */
  freqEndHz?: number;
  wave: 'sine' | 'square' | 'sawtooth' | 'triangle';
  /** Peak gain 0..1. */
  gain: number;
}

/**
 * Deterministic recipe for a bundled tone. Rendered to 22.05 kHz 16-bit mono WAV by
 * scripts/gen-sounds.ts (one loop per file; native loops it) and played live via WebAudio by
 * the web backend. Each note gets a 5 ms linear attack and release to avoid clicks.
 */
export interface ToneRecipe {
  loopMs: number;
  notes: ToneNote[];
}

export interface BundledSound {
  id: BundledSoundId;
  name: string;
  recipe: ToneRecipe;
}

const beeps = (count: number, onMs: number, offMs: number, freqHz: number, wave: ToneNote['wave'], gain: number): ToneNote[] =>
  Array.from({ length: count }, (_, i) => ({ startMs: i * (onMs + offMs), durMs: onMs, freqHz, wave, gain }));

export const BUNDLED_SOUNDS: readonly BundledSound[] = [
  { id: 'classic', name: 'Classic beep', recipe: { loopMs: 1200, notes: beeps(4, 100, 100, 880, 'square', 0.6) } },
  { id: 'pulse', name: 'Pulse', recipe: { loopMs: 500, notes: beeps(1, 250, 0, 1000, 'sine', 0.9) } },
  {
    id: 'siren',
    name: 'Siren',
    recipe: {
      loopMs: 1000,
      notes: [
        { startMs: 0, durMs: 500, freqHz: 600, freqEndHz: 1200, wave: 'sawtooth', gain: 0.5 },
        { startMs: 500, durMs: 500, freqHz: 1200, freqEndHz: 600, wave: 'sawtooth', gain: 0.5 },
      ],
    },
  },
  {
    id: 'chime',
    name: 'Chime',
    recipe: {
      loopMs: 1200,
      notes: [1047, 1319, 1568, 2093].map((freqHz, i) => ({ startMs: i * 180, durMs: 170, freqHz, wave: 'triangle' as const, gain: 0.8 })),
    },
  },
  { id: 'buzzer', name: 'Buzzer', recipe: { loopMs: 800, notes: beeps(1, 600, 0, 220, 'sawtooth', 0.6) } },
  { id: 'rise', name: 'Rise', recipe: { loopMs: 2000, notes: [{ startMs: 0, durMs: 1500, freqHz: 400, freqEndHz: 1600, wave: 'sine', gain: 0.9 }] } },
];

/** Played natively when the selected sound fails (missing custom file, decoder error). [JAVA] res/raw/rouse_classic.wav */
export const BACKUP_SOUND_ID: BundledSoundId = 'classic';
export const DEFAULT_SOUND: SoundRef = { kind: 'bundled', id: 'pulse' };

// ─────────────────────────────────────────────────────────────────────────────
// Mission metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface MissionMeta {
  type: MissionType;
  name: string;
  /** One sentence for the mission picker. */
  description: string;
  /** Device capabilities needed; mission is unavailable (and replaced at ring time) without them. */
  requires: readonly MissionRequirement[];
  /** Needs a setup step before the alarm can be saved (QR registration). */
  needsSetup: boolean;
  /** How hard it is to complete while still in bed / to fake. Shown as a badge. */
  cheatResistance: 'low' | 'medium' | 'high';
  /** Honest, user-facing sentence about how it can be cheated or when it may fail. */
  honestyNote: string;
  /** Accessibility consideration shown in the picker. */
  accessibilityNote: string;
  /** May be picked by randomMission. */
  randomEligible: boolean;
}

export const MISSION_META: Readonly<Record<MissionType, MissionMeta>> = {
  math: {
    type: 'math',
    name: 'Math',
    description: 'Solve arithmetic problems.',
    requires: [],
    needsSetup: false,
    cheatResistance: 'medium',
    honestyNote: 'Wakes your brain, but you can do it without leaving bed.',
    accessibilityNote: 'Hard with dyscalculia; consider Typing instead.',
    randomEligible: true,
  },
  memory: {
    type: 'memory',
    name: 'Memory',
    description: 'Memorise which tiles light up, then tap them.',
    requires: [],
    needsSetup: false,
    cheatResistance: 'medium',
    honestyNote: 'Can be done in bed.',
    accessibilityNote: 'Highlighted tiles use a symbol as well as colour.',
    randomEligible: true,
  },
  typing: {
    type: 'typing',
    name: 'Typing',
    description: 'Type a phrase exactly.',
    requires: [],
    needsSetup: false,
    cheatResistance: 'medium',
    honestyNote: 'Can be done in bed. Long phrases take real focus.',
    accessibilityNote: 'Works with any keyboard and with TalkBack.',
    randomEligible: true,
  },
  shake: {
    type: 'shake',
    name: 'Shake',
    description: 'Shake the phone a number of times.',
    requires: ['motion'],
    needsSetup: false,
    cheatResistance: 'low',
    honestyNote: 'Easy to do lying down. Use a high count or chain it with another mission.',
    accessibilityNote: 'Needs arm strength and grip.',
    randomEligible: true,
  },
  qr: {
    type: 'qr',
    name: 'QR / barcode',
    description: 'Scan the code you registered, e.g. on the bathroom mirror.',
    requires: ['camera'],
    needsSetup: true,
    cheatResistance: 'high',
    honestyNote: 'Strongest way to get out of bed. A photo of the code also works, so keep no copy near your bed.',
    accessibilityNote: 'Needs to find and aim at the code; torch toggle helps in the dark.',
    randomEligible: false,
  },
  tap: {
    type: 'tap',
    name: 'Tap targets',
    description: 'Tap targets as they appear.',
    requires: [],
    needsSetup: false,
    cheatResistance: 'low',
    honestyNote: 'Can be done in bed.',
    accessibilityNote: 'Large targets; no colour-only cues.',
    randomEligible: true,
  },
  steps: {
    type: 'steps',
    name: 'Steps',
    description: 'Walk a number of steps with the phone in your hand.',
    requires: ['motion'],
    needsSetup: false,
    cheatResistance: 'medium',
    honestyNote: 'Detected from motion; rhythmic shaking can sometimes count as steps.',
    accessibilityNote: 'Needs walking; not suitable for wheelchair users.',
    randomEligible: true,
  },
  squat: {
    type: 'squat',
    name: 'Squats',
    description: 'Do squats holding the phone at your chest.',
    requires: ['motion'],
    needsSetup: false,
    cheatResistance: 'low',
    honestyNote: 'Cheatable: moving the phone up and down by hand also counts.',
    accessibilityNote: 'Needs leg strength and balance.',
    randomEligible: true,
  },
};

export const MISSION_TYPES: readonly MissionType[] = ['math', 'memory', 'typing', 'shake', 'qr', 'tap', 'steps', 'squat'];

// ─────────────────────────────────────────────────────────────────────────────
// Factories (pure; callers pass ids and clocks)
// ─────────────────────────────────────────────────────────────────────────────

/** Default config for one mission type. */
export function defaultMissionConfig<T extends MissionType>(type: T): MissionConfigOf<T> {
  const configs: { [K in MissionType]: MissionConfigOf<K> } = {
    math: { type: 'math', difficulty: 2, count: 3 },
    memory: { type: 'memory', gridSize: 4, rounds: 2 },
    typing: { type: 'typing', phraseMode: 'random', customPhrase: '', strictCase: false, phrases: 1 },
    shake: { type: 'shake', count: 30, sensitivity: 'medium' },
    qr: { type: 'qr', expectedCode: '', label: '' },
    tap: { type: 'tap', targets: 15 },
    steps: { type: 'steps', count: 30 },
    squat: { type: 'squat', count: 10 },
  };
  return structuredCloneish(configs[type]);
}

/** The default escape-hatch mission: three random long phrases (no maths, no sensors). */
export const DEFAULT_FALLBACK_MISSION: FallbackMissionConfig = {
  type: 'typing',
  phraseMode: 'random',
  customPhrase: '',
  strictCase: false,
  phrases: 3,
};

export function defaultAlarmDefaults(): AlarmDefaults {
  return {
    sound: { ...DEFAULT_SOUND },
    volume: 80,
    volumeRampSec: 30,
    vibrate: true,
    snooze: { enabled: true, intervalMin: 5, maxCount: 3, requireMission: false },
    missions: [defaultMissionConfig('math')],
    randomMission: false,
    wakeUpCheck: { enabled: false, delayMin: 5, windowMin: 3 },
  };
}

export function defaultSettings(): Settings {
  return {
    theme: 'system',
    clockFormat: 'system',
    weekStartsOn: 1,
    alarmDefaults: defaultAlarmDefaults(),
    fallback: { afterFailures: 3, afterMinutes: 5, mission: structuredCloneish(DEFAULT_FALLBACK_MISSION) },
    silenceWhileSolvingSec: 30,
    bedtimeReminder: { enabled: false, sleepGoalMin: 480 },
    napMinutes: 20,
    onboardingDone: false,
  };
}

export interface NewAlarmOptions {
  id: AlarmId;
  now: EpochMs;
  /** Defaults to 7. */
  hour?: number;
  /** Defaults to 0. */
  minute?: number;
  /** Defaults to Mon–Fri. */
  days?: Alarm['days'];
  /** Usually Settings.alarmDefaults; falls back to defaultAlarmDefaults(). */
  defaults?: AlarmDefaults;
}

/** A new, enabled alarm (not persisted). */
export function createAlarm(opts: NewAlarmOptions): Alarm {
  const d = structuredCloneish(opts.defaults ?? defaultAlarmDefaults());
  return {
    id: opts.id,
    hour: opts.hour ?? 7,
    minute: opts.minute ?? 0,
    days: opts.days ? [...opts.days] : [1, 2, 3, 4, 5],
    enabled: true,
    label: '',
    skipUntil: null,
    deleteAfterRing: false,
    sound: d.sound,
    volume: d.volume,
    volumeRampSec: d.volumeRampSec,
    vibrate: d.vibrate,
    snooze: d.snooze,
    missions: d.missions,
    randomMission: d.randomMission,
    wakeUpCheck: d.wakeUpCheck,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/** Typed deep copy for plain JSON data (avoids relying on structuredClone typings for unions). */
function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** True if the mission config is one of the fallback-capable types. */
export function isFallbackCapable(m: MissionConfig): m is FallbackMissionConfig {
  return m.type === 'math' || m.type === 'typing' || m.type === 'memory' || m.type === 'tap';
}
