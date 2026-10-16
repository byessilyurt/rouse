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

// [foreground, background, minimum]
const PAIRS = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface-2', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5],
  ['accent-text', 'bg', 4.5], ['accent-text', 'surface', 4.5],
  ['accent', 'bg', 3], ['border', 'bg', 3], ['border', 'surface', 3],
];
const ON_ACCENT = { n: '#0c0a24', d: '#ffffff' };
const failures = [];
for (const regime of ['n', 'd']) {
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const c = (name) => {
      const a = tok[`${regime}0-${name}`];
      const b = tok[`${regime}1-${name}`];
      if (!a || !b) throw new Error(`missing token --${regime}0-${name} / --${regime}1-${name}`);
      return mix(a, b, t);
    };
    for (const [fg, bg, min] of PAIRS) {
      const r = ratio(c(fg), c(bg));
      if (r < min) failures.push(`${regime === 'n' ? 'night' : 'day'} t=${t}: ${fg} on ${bg} = ${r.toFixed(2)} (< ${min})`);
    }
    const r = ratio(hex(ON_ACCENT[regime]), c('accent'));
    if (r < 4.5) failures.push(`${regime === 'n' ? 'night' : 'day'} t=${t}: on-accent on accent = ${r.toFixed(2)} (< 4.5)`);
  }
}
// Ring screen (data-signal): signal page, its surfaces, and day-regime status colours used in banners there.
const DAY_STATUS = { info: '#2457a8', warn: '#645600', danger: '#b3261e' };
for (const [name, c] of Object.entries(DAY_STATUS)) {
  for (const bg of ['signal-surface', 'signal-surface-2']) {
    const r = ratio(hex(c), hex(tok[bg]));
    if (r < 4.5) failures.push(`${name} on ${bg} = ${r.toFixed(2)} (< 4.5)`);
  }
}
for (const [fg, bg] of [['on-signal', 'signal'], ['signal-muted', 'signal'], ['on-signal', 'signal-surface'], ['on-signal', 'signal-surface-2'], ['signal-muted', 'signal-surface-2']]) {
  const r = ratio(hex(tok[fg]), hex(tok[bg]));
  if (r < 4.5) failures.push(`${fg} on ${bg} = ${r.toFixed(2)} (< 4.5)`);
}
if (failures.length) {
  console.error(`Contrast check failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`Contrast OK: ${PAIRS.length + 1} pairs × 5 wake levels × 2 regimes, plus the signal pairs.`);
