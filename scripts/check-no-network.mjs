#!/usr/bin/env node
/**
 * CI gate (D-001, D-025): Rouse never talks to the network. Fails if any source under src/
 * uses a network API: fetch(, XMLHttpRequest, WebSocket, EventSource or sendBeacon.
 * Comments are ignored so documentation may mention them.
 *
 *   node scripts/check-no-network.mjs [dir ...]   (default: src)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const PATTERNS = [
  { name: 'fetch(', re: /(?<![\w$.])fetch\s*\(|\.fetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', re: /\bWebSocket\b/ },
  { name: 'EventSource', re: /\bEventSource\b/ },
  { name: 'sendBeacon', re: /\bsendBeacon\b/ },
];

/** Blank out comments while keeping line numbers (strings are left alone). */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function walk(dir, files) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (EXTENSIONS.test(name)) files.push(p);
  }
  return files;
}

const dirs = process.argv.slice(2);
const roots = (dirs.length ? dirs : ['src']).map((d) => resolve(ROOT, d));
const hits = [];
for (const root of roots) {
  for (const file of walk(root, [])) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, idx) => {
      for (const p of PATTERNS) {
        if (p.re.test(line)) hits.push(`${relative(ROOT, file)}:${idx + 1}: ${p.name}: ${line.trim()}`);
      }
    });
  }
}
if (hits.length) {
  console.error('Network APIs are not allowed in Rouse (D-001/D-025):\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`check-no-network: OK (${roots.map((r) => relative(ROOT, r)).join(', ')})`);
