/**
 * Renders BUNDLED_SOUNDS (src/core/defaults.ts) to android/app/src/main/res/raw/rouse_<id>.wav:
 * 22 050 Hz, 16-bit PCM mono, exactly one loop per file (the native player loops it).
 * Deterministic: pure arithmetic, no randomness, no timestamps (D-024, CC0 by construction).
 *
 *   node scripts/gen-sounds.ts          write the files
 *   node scripts/gen-sounds.ts --check  verify the committed files match (CI); exit 1 otherwise
 *
 * Runs under plain Node 22 type-stripping (no bundler).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SOUNDS } from '../src/core/defaults.ts';
import type { ToneNote, ToneRecipe } from '../src/core/defaults.ts';

const SAMPLE_RATE = 22_050;
const EDGE_MS = 5; // linear attack and release per note, avoids clicks
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'android', 'app', 'src', 'main', 'res', 'raw');

function waveAt(wave: ToneNote['wave'], phaseCycles: number): number {
  const x = phaseCycles - Math.floor(phaseCycles); // 0..1
  switch (wave) {
    case 'sine':
      return Math.sin(2 * Math.PI * x);
    case 'square':
      return x < 0.5 ? 1 : -1;
    case 'sawtooth':
      return 2 * x - 1;
    case 'triangle':
      return x < 0.5 ? 4 * x - 1 : 3 - 4 * x;
  }
}

export function renderSamples(recipe: ToneRecipe): Int16Array {
  const total = Math.round((recipe.loopMs * SAMPLE_RATE) / 1000);
  const mix = new Float64Array(total);
  for (const note of recipe.notes) {
    const start = Math.round((note.startMs * SAMPLE_RATE) / 1000);
    const len = Math.round((note.durMs * SAMPLE_RATE) / 1000);
    const edge = Math.max(1, Math.round((EDGE_MS * SAMPLE_RATE) / 1000));
    const durS = note.durMs / 1000;
    const f0 = note.freqHz;
    const f1 = note.freqEndHz ?? note.freqHz;
    for (let n = 0; n < len; n++) {
      const idx = start + n;
      if (idx >= total) break;
      const t = n / SAMPLE_RATE;
      // Phase of a linear sweep: integral of f(t) = f0 + (f1 - f0) * t / dur.
      const cycles = f0 * t + ((f1 - f0) * t * t) / (2 * durS);
      const env = Math.min(1, n / edge, (len - 1 - n) / edge);
      mix[idx] = (mix[idx] ?? 0) + note.gain * Math.max(0, env) * waveAt(note.wave, cycles);
    }
  }
  const out = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const v = Math.max(-1, Math.min(1, mix[i] ?? 0));
    out[i] = Math.round(v * 32767);
  }
  return out;
}

export function toWav(samples: Int16Array): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i] ?? 0, true);
  return new Uint8Array(buf);
}

/** Same header and every sample within ±1 LSB (tolerates libm differences across Node versions). */
function matches(expected: Uint8Array, actual: Uint8Array): boolean {
  if (expected.length !== actual.length) return false;
  for (let i = 0; i < 44; i++) if (expected[i] !== actual[i]) return false;
  const e = new DataView(expected.buffer, expected.byteOffset, expected.byteLength);
  const a = new DataView(actual.buffer, actual.byteOffset, actual.byteLength);
  for (let off = 44; off + 1 < expected.length; off += 2) {
    if (Math.abs(e.getInt16(off, true) - a.getInt16(off, true)) > 1) return false;
  }
  return true;
}

function main(): void {
  const check = process.argv.includes('--check');
  const problems: string[] = [];
  if (!check) mkdirSync(OUT_DIR, { recursive: true });
  for (const sound of BUNDLED_SOUNDS) {
    const file = join(OUT_DIR, `rouse_${sound.id}.wav`);
    const wav = toWav(renderSamples(sound.recipe));
    if (check) {
      if (!existsSync(file)) problems.push(`missing ${file}`);
      else if (!matches(wav, new Uint8Array(readFileSync(file)))) problems.push(`out of date: ${file}`);
    } else {
      writeFileSync(file, wav);
      console.log(`wrote ${file} (${wav.length} bytes)`);
    }
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error('Run `npm run gen:sounds` and commit the result.');
    process.exit(1);
  }
  if (check) console.log(`gen-sounds: ${BUNDLED_SOUNDS.length} files up to date`);
}

main();
