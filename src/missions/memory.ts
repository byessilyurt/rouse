/**
 * Memory-tiles mission engine. OWNER: core agent. API is part of the contract.
 * Round r (0-based) highlights gridSize + r cells at once for showMs, then the user taps them in any order.
 */
import type { MemoryMissionConfig } from '../core/types';
import { LIMITS } from '../core/defaults';
import type { Rng } from './rng';
import { shuffle } from './rng';

export interface MemoryRound {
  gridSize: number;
  /** Sorted unique cell indices (row-major, 0..gridSize²-1) to remember. */
  cells: number[];
  /** How long the pattern is shown. */
  showMs: number;
}

/** docs/plan.md §2.1: the pattern is shown for 1500 ms + 300 ms per highlighted cell. */
export const MEMORY_SHOW_BASE_MS = 1500;
export const MEMORY_SHOW_PER_CELL_MS = 300;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function generateMemoryRounds(config: MemoryMissionConfig, rng: Rng): MemoryRound[] {
  const gridSize = clampInt(config.gridSize, LIMITS.memory.gridSize.min, LIMITS.memory.gridSize.max);
  const rounds = clampInt(config.rounds, LIMITS.memory.rounds.min, LIMITS.memory.rounds.max);
  const total = gridSize * gridSize;
  const all = Array.from({ length: total }, (_, i) => i);
  const out: MemoryRound[] = [];
  let previous = '';
  for (let r = 0; r < rounds; r++) {
    // Never highlight the whole grid (that would need no memory at all).
    const count = Math.min(gridSize + r, total - 1);
    let cells: number[] = [];
    // Avoid showing the exact same pattern twice in a row; a few retries are plenty.
    for (let attempt = 0; attempt < 5; attempt++) {
      cells = shuffle(rng, all)
        .slice(0, count)
        .sort((a, b) => a - b);
      if (cells.join(',') !== previous) break;
    }
    previous = cells.join(',');
    out.push({ gridSize, cells, showMs: MEMORY_SHOW_BASE_MS + MEMORY_SHOW_PER_CELL_MS * count });
  }
  return out;
}

/** 'wrong' = tapped a non-pattern cell (round fails, counts as a failed attempt); 'complete' = all cells found. Re-taps are ignored. */
export type MemoryTapResult = 'progress' | 'complete' | 'wrong' | 'ignored';

export function checkMemoryTap(round: MemoryRound, selectedSoFar: readonly number[], tapped: number): MemoryTapResult {
  const total = round.gridSize * round.gridSize;
  if (!Number.isInteger(tapped) || tapped < 0 || tapped >= total) return 'ignored';
  if (selectedSoFar.includes(tapped)) return 'ignored';
  if (!round.cells.includes(tapped)) return 'wrong';
  const found = new Set(selectedSoFar.filter((c) => round.cells.includes(c)));
  found.add(tapped);
  return found.size >= round.cells.length ? 'complete' : 'progress';
}
