/**
 * QR / barcode matching. OWNER: core agent. API is part of the contract.
 * Decoding (BarcodeDetector → jsQR fallback) lives in the UI (src/ui/missions/qr/); this is pure.
 */
import { notImplemented } from '../core/notImplemented';

/** Strip BOM / zero-width chars / trailing CR-LF, NFC, trim. Case is PRESERVED. */
export function normalizeCode(raw: string): string {
  return notImplemented(`normalizeCode(${raw.length})`);
}

/** normalizeCode(expected) === normalizeCode(scanned), and expected is non-empty. */
export function codesMatch(expected: string, scanned: string): boolean {
  return notImplemented(`codesMatch(${expected.length}, ${scanned.length})`);
}

/** Short display form, e.g. "https://exa…/3f9a" (max 24 chars). */
export function describeCode(code: string): string {
  return notImplemented(`describeCode(${code.length})`);
}
