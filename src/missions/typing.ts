/**
 * Typing mission engine. OWNER: core agent. API is part of the contract.
 */
import type { TypingMissionConfig } from '../core/types';
import { LIMITS } from '../core/defaults';
import type { Rng } from './rng';
import { shuffle } from './rng';

/** Bundled phrases (core fills: ≥40 short 25–60 chars, ≥20 long 80–140 chars; original/public-domain, plain ASCII). */
export const SHORT_PHRASES: readonly string[] = [
  'Good morning, the day is waiting for me.',
  'I am getting up right now, not later.',
  'Fresh air and cold water wake me up.',
  'My feet are on the floor and I feel fine.',
  'Today I will do one thing that matters.',
  'The coffee will not make itself this morning.',
  'Open the curtains and let the light in.',
  'A slow start is still a start.',
  'Stretch your arms and take a deep breath.',
  'Every morning is a chance to begin again.',
  'The bed will still be here tonight.',
  'Sunlight is the best alarm of all.',
  'I chose to wake up early for a reason.',
  'Drink a glass of water before anything else.',
  'Small steps in the morning make big days.',
  'The early bird gets the quiet kitchen.',
  'Snoozing never made anyone feel rested.',
  'Wake up, stand up, and get moving.',
  'Breakfast tastes better when there is time.',
  'I am awake, alert, and ready to go.',
  'My future self will thank me for this.',
  'The kettle is calling from the kitchen.',
  'Ten more minutes is a promise I never keep.',
  'Morning light makes the whole room glow.',
  'Put on some music and start the day.',
  'Make the bed and the day starts tidy.',
  'A clear head starts with a cold splash.',
  'There is a whole day out there to explore.',
  'Wiggle your toes, then sit up slowly.',
  'The birds have been up for hours already.',
  'Today is a good day to be on time.',
  'Get up first, decide how you feel later.',
  'One deep breath, then out of bed.',
  'The best part of waking up is getting up.',
  'Plans only work if I am awake for them.',
  'Lace up your shoes and greet the morning.',
  'Mornings are easier once you are standing.',
  'The sun rose without hitting snooze.',
  'Warm socks, warm tea, and a fresh start.',
  'I can rest later; right now I rise.',
  'Water the plants and say hello to the day.',
  'The quiet hour before work is all mine.',
  'Bright eyes and a busy brain this morning.',
  'Nothing good happens under the blanket.',
];

export const LONG_PHRASES: readonly string[] = [
  'The alarm kept ringing until I got up, which is exactly what I asked it to do last night.',
  'I promised myself yesterday that I would get up on time, and today I am keeping that promise.',
  'Somewhere a kettle is waiting, a window wants opening, and a whole day is ready to begin.',
  'If I am awake enough to type this whole sentence correctly, I am awake enough to stand up.',
  'Mornings are not about being perfect; they are about getting up and taking the first step.',
  'The light through the window, the sound of birds, and cold water on my face will help me wake.',
  'A good day often starts with a small win, and getting out of bed on time is a small win.',
  'I will put both feet on the floor, stretch toward the ceiling, and walk to the kitchen now.',
  'The blanket is warm and the pillow is soft, but the plans I made for today matter more.',
  'Every time I get up without snoozing, it becomes a little easier to do it again tomorrow.',
  'Breakfast, a short walk, and a glass of water are the three best ways to clear a sleepy head.',
  'Typing a long sentence at dawn is hard, which is the whole point: my brain is now switching on.',
  'The day ahead has meetings, errands, and maybe a nice surprise, and I want to be awake for it.',
  'Out there the streets are quiet, the air is cool, and the morning belongs to whoever is up.',
  'I set this alarm because I know myself, and I know that lying here longer will not help me.',
  'My eyes are open, my fingers are moving, and in a moment my feet will be on the cold floor.',
  'Getting up early gives me time to think, to plan, and to enjoy a slow cup of something warm.',
  'The hardest part of the morning is the first minute; after that, everything gets much easier.',
  'Stand up, open the curtains, take three deep breaths, and the sleepy fog will start to lift.',
  'Rest is important, but so is keeping the promises I make to myself the night before.',
  'A rested mind, a stretched body, and a full glass of water make a strong start to any day.',
  'Even on grey mornings there is something good waiting, as long as I get up to go and find it.',
];

/** 'custom' → [customPhrase]; 'random' → `phrases` distinct SHORT_PHRASES (LONG_PHRASES when phrases >= 3, i.e. fallback). */
export function pickPhrases(config: TypingMissionConfig, rng: Rng): string[] {
  if (config.phraseMode === 'custom') {
    const custom = config.customPhrase.trim();
    // An empty custom phrase cannot be saved (validation); fall back to a bundled one rather than
    // an impossible (or trivially empty) task if one slips through.
    if (custom !== '') return [custom];
  }
  const raw = Number.isFinite(config.phrases) ? Math.round(config.phrases) : 1;
  const n = Math.min(LIMITS.typing.phrases.max, Math.max(LIMITS.typing.phrases.min, raw));
  const pool = n >= 3 ? LONG_PHRASES : SHORT_PHRASES;
  return shuffle(rng, pool).slice(0, n);
}

/** NFC; curly quotes → straight; en/em dashes → '-'; collapse whitespace; trim; lower-case unless strictCase. */
export function normalizePhrase(text: string, strictCase: boolean): string {
  const s = text
    .normalize('NFC')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
  return strictCase ? s : s.toLowerCase();
}

export interface PhraseCheck {
  matches: boolean;
  /** Length of the correct prefix of the NORMALISED typed text (for progress highlighting). */
  correctPrefixLength: number;
}

export function comparePhrase(expected: string, typed: string, strictCase: boolean): PhraseCheck {
  const e = normalizePhrase(expected, strictCase);
  const t = normalizePhrase(typed, strictCase);
  let i = 0;
  while (i < e.length && i < t.length && e[i] === t[i]) i++;
  return { matches: e === t, correctPrefixLength: i };
}
