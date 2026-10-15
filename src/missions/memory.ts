/**
 * Memory-tiles mission engine. OWNER: core agent. API is part of the contract.
 * Round r (0-based) highlights gridSize + r cells at once for showMs, then the user taps them in any order.
 */
import type { MemoryMissionConfig } from '../core/types';
import type { Rng } from './rng';
import { notImplemented } from '../core/notImplemented';

export interface MemoryRound {
  gridSize: number;
  /** Sorted unique cell indices (row-major, 0..gridSize²-1) to remember. */
  cells: number[];
  /** How long the pattern is shown. */
  showMs: number;
}

export function generateMemoryRounds(config: MemoryMissionConfig, rng: Rng): MemoryRound[] {
  return notImplemented(`generateMemoryRounds(${config.gridSize}, ${typeof rng})`);
}

/** 'wrong' = tapped a non-pattern cell (round fails, counts as a failed attempt); 'complete' = all cells found. Re-taps are ignored. */
export type MemoryTapResult = 'progress' | 'complete' | 'wrong' | 'ignored';

export function checkMemoryTap(round: MemoryRound, selectedSoFar: readonly number[], tapped: number): MemoryTapResult {
  return notImplemented(`checkMemoryTap(${round.cells.length}, ${selectedSoFar.length}, ${tapped})`);
}
