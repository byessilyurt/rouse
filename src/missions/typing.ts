/**
 * Typing mission engine. OWNER: core agent. API is part of the contract.
 */
import type { TypingMissionConfig } from '../core/types';
import type { Rng } from './rng';
import { notImplemented } from '../core/notImplemented';

/** Bundled phrases (core fills: ≥40 short 25–60 chars, ≥20 long 80–140 chars; original/public-domain, plain ASCII). */
export const SHORT_PHRASES: readonly string[] = [];
export const LONG_PHRASES: readonly string[] = [];

/** 'custom' → [customPhrase]; 'random' → `phrases` distinct SHORT_PHRASES (LONG_PHRASES when phrases >= 3, i.e. fallback). */
export function pickPhrases(config: TypingMissionConfig, rng: Rng): string[] {
  return notImplemented(`pickPhrases(${config.phraseMode}, ${typeof rng})`);
}

/** NFC; curly quotes → straight; en/em dashes → '-'; collapse whitespace; trim; lower-case unless strictCase. */
export function normalizePhrase(text: string, strictCase: boolean): string {
  return notImplemented(`normalizePhrase(${text.length}, ${strictCase})`);
}

export interface PhraseCheck {
  matches: boolean;
  /** Length of the correct prefix of the NORMALISED typed text (for progress highlighting). */
  correctPrefixLength: number;
}

export function comparePhrase(expected: string, typed: string, strictCase: boolean): PhraseCheck {
  return notImplemented(`comparePhrase(${expected.length}, ${typed.length}, ${strictCase})`);
}
