#!/usr/bin/env node
/**
 * Contrast gate for the "Awake" tokens (docs/design-language.md §1.2). Reads the *0/*1 colour endpoints
 * from src/ui/tokens.css, mixes them in OKLab like color-mix() does at several wake levels, and checks every
 * text and control pair against WCAG AA. Exits 1 on any failure.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(ROOT, 'src/ui/tokens.css'), 'utf8');
const tok = {};
for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) tok[m[1]] ??= m[2].toLowerCase();

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklab([r, g, b]) {
  [r, g, b] = [r, g, b].map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((c) => Math.min(1, Math.max(0, unlin(c))));
}
const mix = (a, b, t) => fromOklab(toOklab(hex(a)).map((v, i) => v + (toOklab(hex(b))[i] - v) * t));
const lum = (rgb) => rgb.map(lin).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };

// Swatches are the single source in src/ui/palette.ts (Node 22 strips its types on import).
const { ACCENTS, RING_COLORS } = await import('../src/ui/palette.ts');

// [foreground, background, minimum] over the neutrals in tokens.css.
const PAIRS = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface-2', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5],
  ['border', 'bg', 3], ['border', 'surface', 3],
];
const failures = [];
let checked = 0;
const check = (label, fg, bg, min) => {
  checked++;
  const r = ratio(fg, bg);
  if (r < min) failures.push(`${label} = ${r.toFixed(2)} (< ${min})`);
};
for (const regime of ['n', 'd']) {
  const name = regime === 'n' ? 'night' : 'day';
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const c = (key) => {
      const a = tok[`${regime}0-${key}`];
      const b = tok[`${regime}1-${key}`];
      if (!a || !b) throw new Error(`missing token --${regime}0-${key} / --${regime}1-${key}`);
      return mix(a, b, t);
    };
    for (const [fg, bg, min] of PAIRS) check(`${name} t=${t}: ${fg} on ${bg}`, c(fg), c(bg), min);
    for (const a of ACCENTS) {
      const [acc0, txt0] = a[`${regime}0`];
      const [acc1, txt1] = a[`${regime}1`];
      const accent = mix(acc0, acc1, t);
      const accentText = mix(txt0, txt1, t);
      const label = `${name} t=${t} accent ${a.id}`;
      check(`${label}: accent-text on bg`, accentText, c('bg'), 4.5);
      check(`${label}: accent-text on surface`, accentText, c('surface'), 4.5);
      check(`${label}: accent on bg`, accent, c('bg'), 3);
      check(`${label}: on-accent on accent`, hex(regime === 'n' ? a.onNight : a.onDay), accent, 4.5);
    }
  }
}
// Ring screen: signal page, its surfaces, and day-regime status colours used in banners there.
const DAY_STATUS = { info: '#2457a8', warn: '#645600', danger: '#b3261e' };
for (const r of RING_COLORS) {
  const label = `ring ${r.id}`;
  check(`${label}: on-signal on signal`, hex(r.onSignal), hex(r.signal), 4.5);
  check(`${label}: signal-muted on signal`, hex(r.signalMuted), hex(r.signal), 4.5);
  for (const [bgName, bg] of [['surface', r.surface], ['surface-2', r.surface2]]) {
    check(`${label}: on-signal on ${bgName}`, hex(r.onSignal), hex(bg), 4.5);
    check(`${label}: signal-muted on ${bgName}`, hex(r.signalMuted), hex(bg), 4.5);
    for (const [s, c] of Object.entries(DAY_STATUS)) check(`${label}: ${s} on ${bgName}`, hex(c), hex(bg), 4.5);
  }
}
if (failures.length) {
  console.error(`Contrast check failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`Contrast OK: ${checked} pairs (${ACCENTS.length} accents, ${RING_COLORS.length} ring colours, both regimes, 5 wake levels).`);
