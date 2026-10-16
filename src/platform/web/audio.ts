/**
 * WebAudio synthesis of the BUNDLED_SOUNDS recipes (D-024). Web demo only.
 * Browsers only let audio start after a user gesture: `unlock()` is called from the first
 * pointer/key event, and `blocked` tells the backend to show its "Tap to start sound" button.
 */
import type { ToneNote, ToneRecipe } from '../../core/defaults';

type Ctx = AudioContext;

function audioContextCtor(): (new () => Ctx) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let sharedCtx: Ctx | null = null;
function getCtx(): Ctx | null {
  if (sharedCtx) return sharedCtx;
  const C = audioContextCtor();
  if (!C) return null;
  try {
    sharedCtx = new C();
  } catch {
    sharedCtx = null;
  }
  return sharedCtx;
}

/** Resume the shared context (call from a user gesture). Resolves true if audio can play. */
export async function unlockAudio(): Promise<boolean> {
  const ctx = getCtx();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    /* ignore */
  }
  return ctx.state === 'running';
}

export function audioBlocked(): boolean {
  const ctx = getCtx();
  return !!ctx && ctx.state !== 'running';
}

export function audioAvailable(): boolean {
  return audioContextCtor() !== null;
}

const ATTACK = 0.005;

function scheduleNote(ctx: Ctx, dest: AudioNode, n: ToneNote, t0: number): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = n.wave;
  const start = t0 + n.startMs / 1000;
  const dur = n.durMs / 1000;
  osc.frequency.setValueAtTime(n.freqHz, start);
  if (n.freqEndHz !== undefined) osc.frequency.linearRampToValueAtTime(n.freqEndHz, start + dur);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(n.gain, start + Math.min(ATTACK, dur / 2));
  if (n.decayMs) {
    // Matches gen-sounds.ts: e^-3 (~5%) after decayMs.
    g.gain.setTargetAtTime(0, start + ATTACK, n.decayMs / 3000);
    g.gain.cancelScheduledValues(start + dur - ATTACK);
    g.gain.setValueAtTime(n.gain * Math.exp((-3 * (dur - 2 * ATTACK) * 1000) / n.decayMs), start + dur - ATTACK);
  } else {
    g.gain.setValueAtTime(n.gain, Math.max(start + ATTACK, start + dur - ATTACK));
  }
  g.gain.linearRampToValueAtTime(0, start + dur);
  osc.connect(g).connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** One looping (or one-shot) tone voice with its own master gain. */
export class ToneVoice {
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextLoopAt = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private targetGain = 1;
  private muted = false;

  /** volume 0..1; rampSec 0 = full immediately. maxMs auto-stops (previews). */
  play(recipe: ToneRecipe, opts: { volume: number; rampSec?: number; loop?: boolean; maxMs?: number }): void {
    this.stop();
    const ctx = getCtx();
    if (!ctx) return;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.master = master;
    this.targetGain = Math.max(0.01, Math.min(1, opts.volume));
    this.muted = false;
    const now = ctx.currentTime;
    const ramp = opts.rampSec ?? 0;
    if (ramp > 0) {
      master.gain.setValueAtTime(this.targetGain * 0.03, now);
      master.gain.exponentialRampToValueAtTime(this.targetGain, now + ramp);
    } else {
      master.gain.setValueAtTime(this.targetGain, now);
    }
    this.nextLoopAt = now + 0.05;
    const loopSec = recipe.loopMs / 1000;
    const fill = () => {
      if (!this.master) return;
      const horizon = ctx.currentTime + 1.5;
      while (this.nextLoopAt < horizon) {
        for (const n of recipe.notes) scheduleNote(ctx, master, n, this.nextLoopAt);
        this.nextLoopAt += loopSec;
        if (opts.loop === false) {
          this.nextLoopAt = Number.POSITIVE_INFINITY;
          break;
        }
      }
    };
    fill();
    // Real-time scheduling must not depend on (possibly faked) page timers for correctness;
    // a missed tick only means a short gap.
    this.timer = setInterval(fill, 400);
    if (opts.maxMs) this.stopTimer = setTimeout(() => this.stop(), opts.maxMs);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const ctx = getCtx();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(muted ? 0 : this.targetGain, t);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.timer = null;
    this.stopTimer = null;
    if (this.master) {
      try {
        this.master.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.master = null;
  }
}
