/**
 * Validation & normalisation. OWNER: core agent. API is part of the contract.
 * Used by the alarm editor (live errors), storage migration and backup import.
 */
import type { Alarm, Settings, ValidationIssue } from './types';
import { notImplemented } from './notImplemented';

/** Problems that block saving (QR without code, > MAX_MISSIONS, out-of-range numbers, bad days…). [] = valid. */
export function validateAlarm(alarm: Alarm): ValidationIssue[] {
  return notImplemented(`validateAlarm(${alarm.id})`);
}

/** Clamp numbers into LIMITS, sort+dedupe days, trim label to MAX_LABEL_LENGTH. Never throws. */
export function normalizeAlarm(alarm: Alarm): Alarm {
  return notImplemented(`normalizeAlarm(${alarm.id})`);
}

/** Parse untrusted JSON-ish input (storage, backup) into an Alarm; missing optional fields get defaults. */
export function parseAlarm(raw: unknown): { ok: true; alarm: Alarm } | { ok: false; issues: ValidationIssue[] } {
  return notImplemented(`parseAlarm(${typeof raw})`);
}

/** Parse untrusted settings; every missing/invalid field falls back to defaultSettings(). Never fails. */
export function parseSettings(raw: unknown): Settings {
  return notImplemented(`parseSettings(${typeof raw})`);
}
