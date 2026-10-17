/**
 * User-selectable colours (Settings → Appearance; design-language.md §1.4). Single source of truth: ThemeSync
 * writes the chosen set onto <html> as CSS custom properties, and scripts/check-contrast.mjs checks every
 * swatch against the neutrals in tokens.css in both regimes. No orange, amber or cream (D-079).
 */
import type { AccentId, RingColorId } from '../core/types';

/** Accent endpoints per regime: n0/n1 = night at wake 0 / 0.5, d0/d1 = day at wake 0.5 / 1. */
export interface AccentSwatch {
  id: AccentId;
  name: string;
  /** [accent, accent-text] at each endpoint. */
  n0: [string, string];
  n1: [string, string];
  d0: [string, string];
  d1: [string, string];
  /** Text/icons on a solid accent fill, per regime. */
  onNight: string;
  onDay: string;
}

export interface RingSwatch {
  id: RingColorId;
  name: string;
  signal: string;
  onSignal: string;
  signalMuted: string;
  surface: string;
  surface2: string;
}

export const ACCENTS: readonly AccentSwatch[] = [
  { id: 'violet', name: 'Violet', n0: ['#8e80f0', '#a497ff'], n1: ['#b2a6ff', '#c6bcff'], d0: ['#3a34c4', '#332db0'], d1: ['#2b20f0', '#2419d0'], onNight: '#0c0a24', onDay: '#ffffff' },
  { id: 'blue', name: 'Blue', n0: ['#5f9dff', '#78acff'], n1: ['#8db9ff', '#a3c6ff'], d0: ['#1f5fd6', '#1b4fb8'], d1: ['#0b57ff', '#0a47d6'], onNight: '#04122b', onDay: '#ffffff' },
  { id: 'teal', name: 'Teal', n0: ['#2fb7aa', '#45c4b8'], n1: ['#5fd8cc', '#7fe3d9'], d0: ['#0b6f68', '#0a6560'], d1: ['#007a71', '#006b63'], onNight: '#031a17', onDay: '#ffffff' },
  { id: 'green', name: 'Green', n0: ['#5cc46a', '#6fcf7c'], n1: ['#86e08f', '#9de8a5'], d0: ['#1f7a31', '#1a6b2a'], d1: ['#14802b', '#116f25'], onNight: '#06190a', onDay: '#ffffff' },
  { id: 'pink', name: 'Pink', n0: ['#e879c4', '#ef8fce'], n1: ['#ff9fdc', '#ffb6e5'], d0: ['#b0237f', '#9d1f72'], d1: ['#c2148a', '#a8127a'], onNight: '#260619', onDay: '#ffffff' },
  { id: 'graphite', name: 'Graphite', n0: ['#a9a9b6', '#b9b9c4'], n1: ['#dcdce6', '#e6e6ee'], d0: ['#33343d', '#2a2b33'], d1: ['#16171c', '#111216'], onNight: '#0b0b10', onDay: '#ffffff' },
];

export const RING_COLORS: readonly RingSwatch[] = [
  { id: 'lime', name: 'Lime', signal: '#c8ff2e', onSignal: '#0b0d05', signalMuted: '#33400c', surface: '#ecffbd', surface2: '#ddff8f' },
  { id: 'cyan', name: 'Cyan', signal: '#3ee8ff', onSignal: '#03171a', signalMuted: '#0b3d44', surface: '#d4faff', surface2: '#a8f3ff' },
  { id: 'pink', name: 'Pink', signal: '#ff7ad3', onSignal: '#1f0618', signalMuted: '#4d0f3a', surface: '#ffe0f4', surface2: '#ffd0ef' },
  { id: 'violet', name: 'Violet', signal: '#a596ff', onSignal: '#0c0826', signalMuted: '#2a1f6b', surface: '#ebe7ff', surface2: '#d9d2ff' },
  { id: 'yellow', name: 'Yellow', signal: '#ffe94a', onSignal: '#161300', signalMuted: '#463d00', surface: '#fff8c4', surface2: '#fff29a' },
  { id: 'white', name: 'White', signal: '#ffffff', onSignal: '#0b0b10', signalMuted: '#3b3c47', surface: '#f1f2f6', surface2: '#e3e5ec' },
];

export const accentById = (id: AccentId): AccentSwatch => ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]!;
export const ringById = (id: RingColorId): RingSwatch => RING_COLORS.find((r) => r.id === id) ?? RING_COLORS[0]!;

/** CSS custom properties for the chosen swatches (consumed by tokens.css). */
export function paletteVars(accent: AccentId, ring: RingColorId): Record<string, string> {
  const a = accentById(accent);
  const r = ringById(ring);
  return {
    '--n0-accent': a.n0[0],
    '--n0-accent-text': a.n0[1],
    '--n1-accent': a.n1[0],
    '--n1-accent-text': a.n1[1],
    '--d0-accent': a.d0[0],
    '--d0-accent-text': a.d0[1],
    '--d1-accent': a.d1[0],
    '--d1-accent-text': a.d1[1],
    '--on-accent-night': a.onNight,
    '--on-accent-day': a.onDay,
    '--signal': r.signal,
    '--on-signal': r.onSignal,
    '--signal-muted': r.signalMuted,
    '--signal-surface': r.surface,
    '--signal-surface-2': r.surface2,
  };
}
