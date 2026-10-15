/**
 * Math mission engine. OWNER: core agent. API is part of the contract.
 * Difficulty ladder (docs/plan.md §2.1): 1 a+b (1-digit) · 2 a+b (2-digit) · 3 a×b+c (2-digit×1-digit + 2-digit)
 * · 4 a×b (2-digit×2-digit) · 5 a×b+c×d (2-digit×1-digit + 2-digit×2-digit). Answers are non-negative integers,
 * no duplicates within one set, no trivial operands (0, 1, 10).
 */
import type { MathMissionConfig } from '../core/types';
import type { Rng } from './rng';
import { notImplemented } from '../core/notImplemented';

export interface MathProblem {
  /** Display text using real operators, e.g. "23 × 7 + 41". */
  prompt: string;
  /** Screen-reader text, e.g. "23 times 7 plus 41". */
  spoken: string;
  answer: number;
}

export function generateMathProblems(config: MathMissionConfig, rng: Rng): MathProblem[] {
  return notImplemented(`generateMathProblems(${config.difficulty}, ${typeof rng})`);
}

/** Lenient parse of user input: trims, ignores spaces/thousand separators, accepts '−'. */
export function checkMathAnswer(problem: MathProblem, input: string): boolean {
  return notImplemented(`checkMathAnswer(${problem.prompt}, ${input})`);
}
