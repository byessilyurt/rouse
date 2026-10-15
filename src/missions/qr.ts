/**
 * QR / barcode matching. OWNER: core agent. API is part of the contract.
 * Decoding (BarcodeDetector → jsQR fallback) lives in the UI (src/ui/missions/qr/); this is pure.
 */

/** BOM, zero-width space/joiners, word joiner. Scanners and copy-paste sometimes add these. */
const INVISIBLE_CHARS = /[﻿​-‍⁠]/g;
const DESCRIBE_MAX = 24;

/** Strip BOM / zero-width chars / trailing CR-LF, NFC, trim. Case is PRESERVED. */
export function normalizeCode(raw: string): string {
  return raw.replace(INVISIBLE_CHARS, '').replace(/[\r\n]+$/, '').normalize('NFC').trim();
}

/** normalizeCode(expected) === normalizeCode(scanned), and expected is non-empty. */
export function codesMatch(expected: string, scanned: string): boolean {
  const e = normalizeCode(expected);
  return e !== '' && e === normalizeCode(scanned);
}

/** Short display form, e.g. "https://exa…/3f9a" (max 24 chars). */
export function describeCode(code: string): string {
  // Code points, not UTF-16 units, so an emoji is never cut in half. Control chars are not displayable.
  const chars = Array.from(normalizeCode(code).replace(/[\u0000-\u001F\u007F]/g, ' '));
  if (chars.length <= DESCRIBE_MAX) return chars.join('');
  const tail = 8;
  const head = DESCRIBE_MAX - 1 - tail;
  return `${chars.slice(0, head).join('')}…${chars.slice(-tail).join('')}`;
}
