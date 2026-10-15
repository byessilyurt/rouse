/**
 * Math mission engine. OWNER: core agent. API is part of the contract.
 * Difficulty ladder (docs/plan.md §2.1): 1 a+b (1-digit) · 2 a+b (2-digit) · 3 a×b+c (2-digit×1-digit + 2-digit)
 * · 4 a×b (2-digit×2-digit) · 5 a×b+c×d (2-digit×1-digit + 2-digit×2-digit). Answers are non-negative integers,
 * no duplicates within one set, no trivial operands (0, 1, 10).
 */
import type { MathDifficulty, MathMissionConfig } from '../core/types';
import { LIMITS } from '../core/defaults';
import type { Rng } from './rng';
import { randInt } from './rng';

export interface MathProblem {
  /** Display text using real operators, e.g. "23 × 7 + 41". */
  prompt: string;
  /** Screen-reader text, e.g. "23 times 7 plus 41". */
  spoken: string;
  answer: number;
}

/** 2..9: one digit, never 0 or 1. */
const oneDigit = (rng: Rng): number => randInt(rng, 2, 9);
/** 11..99 without multiples of ten (10, 20… are too easy to multiply). */
function twoDigit(rng: Rng, min = 11, max = 99): number {
  for (;;) {
    const n = randInt(rng, min, max);
    if (n % 10 !== 0) return n;
  }
}

interface Term {
  /** Factors of one product (a single number is a 1-factor product). */
  factors: number[];
}

/** One problem = a sum of products. Canonical key treats a+b = b+a and a×b = b×a as the same problem. */
function build(terms: Term[]): MathProblem & { key: string } {
  const prompt = terms.map((t) => t.factors.join(' × ')).join(' + ');
  const spoken = terms.map((t) => t.factors.join(' times ')).join(' plus ');
  const answer = terms.reduce((sum, t) => sum + t.factors.reduce((p, f) => p * f, 1), 0);
  const key = terms
    .map((t) => [...t.factors].sort((a, b) => a - b).join('*'))
    .sort()
    .join('+');
  return { prompt, spoken, answer, key };
}

function generateOne(difficulty: MathDifficulty, rng: Rng): MathProblem & { key: string } {
  switch (difficulty) {
    case 1:
      return build([{ factors: [oneDigit(rng)] }, { factors: [oneDigit(rng)] }]);
    case 2:
      return build([{ factors: [twoDigit(rng)] }, { factors: [twoDigit(rng)] }]);
    case 3:
      return build([{ factors: [twoDigit(rng), oneDigit(rng)] }, { factors: [twoDigit(rng)] }]);
    case 4:
      return build([{ factors: [twoDigit(rng, 12, 49), twoDigit(rng, 12, 49)] }]);
    case 5:
      return build([{ factors: [twoDigit(rng), oneDigit(rng)] }, { factors: [twoDigit(rng, 12, 49), twoDigit(rng, 12, 49)] }]);
  }
}

export function generateMathProblems(config: MathMissionConfig, rng: Rng): MathProblem[] {
  const d = Math.round(config.difficulty);
  const difficulty = Math.min(5, Math.max(1, Number.isFinite(d) ? d : 2)) as MathDifficulty;
  const rawCount = Number.isFinite(config.count) ? Math.round(config.count) : 1;
  const count = Math.min(LIMITS.math.count.max, Math.max(LIMITS.math.count.min, rawCount));
  const seen = new Set<string>();
  const out: MathProblem[] = [];
  // Difficulty 1 has 36 distinct problems, more than the 20 maximum, so this always terminates;
  // the attempt cap is only a guard against a broken Rng.
  for (let attempt = 0; out.length < count && attempt < 10_000; attempt++) {
    const { key, ...problem } = generateOne(difficulty, rng);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(problem);
  }
  return out;
}

/** Thousands-grouped number: 1,234 · 1.234 · 1 234 · 1'234 (with any of these separators). */
const GROUPED = /^[+-]?\d{1,3}([,.'’   ]\d{3})+$/;

/** Lenient parse of user input: trims, ignores spaces/thousand separators, accepts '−'. */
export function checkMathAnswer(problem: MathProblem, input: string): boolean {
  let s = input.normalize('NFKC').replace(/[−‒–﹣－]/g, '-').trim();
  if (GROUPED.test(s)) s = s.replace(/[,.'’   ]/g, '');
  s = s.replace(/\s+/g, '');
  if (!/^[+-]?\d+$/.test(s)) return false;
  return Number(s) === problem.answer;
}
