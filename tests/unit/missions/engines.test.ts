import { describe, expect, it } from 'vitest';
import { createRng, pick, randInt, randomRng, shuffle } from '../../../src/missions/rng';
import { checkMathAnswer, generateMathProblems } from '../../../src/missions/math';
import type { MathProblem } from '../../../src/missions/math';
import { MEMORY_SHOW_BASE_MS, MEMORY_SHOW_PER_CELL_MS, checkMemoryTap, generateMemoryRounds } from '../../../src/missions/memory';
import { LONG_PHRASES, SHORT_PHRASES, comparePhrase, normalizePhrase, pickPhrases } from '../../../src/missions/typing';
import { TAP_MIN_DISTANCE, TAP_TOP_EXCLUDED, generateTapTargets, isHit } from '../../../src/missions/tap';
import { codesMatch, describeCode, normalizeCode } from '../../../src/missions/qr';
import { defaultMissionConfig } from '../../../src/core/defaults';
import type { MathDifficulty } from '../../../src/core/types';

describe('rng', () => {
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = createRng(123);
    const b = createRng(123);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(createRng(124)()).not.toBe(createRng(123)());
    expect(new Set(xs).size).toBeGreaterThan(990);
  });
  it('randomRng is not seeded identically', () => {
    expect(Array.from({ length: 4 }, randomRng().bind(null))).not.toEqual(Array.from({ length: 4 }, randomRng().bind(null)));
  });
  it('randInt covers the inclusive range and rejects empty ranges', () => {
    const rng = createRng(1);
    const seen = new Set(Array.from({ length: 500 }, () => randInt(rng, 2, 5)));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
    expect(randInt(() => 0.9999999999, 1, 3)).toBe(3);
    expect(randInt(() => 1, 1, 3)).toBe(3); // defensive against a broken rng
    expect(() => randInt(rng, 5, 4)).toThrow(RangeError);
  });
  it('pick and shuffle', () => {
    const rng = createRng(2);
    expect(() => pick(rng, [])).toThrow(RangeError);
    expect(['a', 'b']).toContain(pick(rng, ['a', 'b']));
    const items = [1, 2, 3, 4, 5, 6];
    const s = shuffle(rng, items);
    expect(s).not.toBe(items);
    expect([...s].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('math', () => {
  const parse = (p: MathProblem): number[] => p.prompt.split(/ [+×] /).map(Number);
  const check = (d: MathDifficulty, test: (ops: number[], p: MathProblem) => void) => {
    for (let seed = 0; seed < 30; seed++) {
      for (const p of generateMathProblems({ type: 'math', difficulty: d, count: 20 }, createRng(seed))) test(parse(p), p);
    }
  };

  it('every answer is a non-negative integer equal to the prompt, with no 0/1/10 operands', () => {
    for (const d of [1, 2, 3, 4, 5] as MathDifficulty[]) {
      check(d, (ops, p) => {
        expect(Number.isInteger(p.answer)).toBe(true);
        expect(p.answer).toBeGreaterThan(0);
        const evaluated = p.prompt.split(' + ').reduce((sum, term) => sum + term.split(' × ').reduce((x, f) => x * Number(f), 1), 0);
        expect(evaluated).toBe(p.answer);
        for (const o of ops) expect([0, 1, 10]).not.toContain(o);
        expect(p.spoken).toBe(p.prompt.replace(/ × /g, ' times ').replace(/ \+ /g, ' plus '));
      });
    }
  });

  it('difficulty ladder shapes', () => {
    check(1, (ops, p) => {
      expect(p.prompt).toMatch(/^\d \+ \d$/);
      ops.forEach((o) => expect(o).toBeGreaterThanOrEqual(2));
    });
    check(2, (ops, p) => {
      expect(p.prompt).toMatch(/^\d\d \+ \d\d$/);
      ops.forEach((o) => expect(o).toBeGreaterThanOrEqual(11));
    });
    check(3, (_ops, p) => expect(p.prompt).toMatch(/^\d\d × \d \+ \d\d$/));
    check(4, (ops, p) => {
      expect(p.prompt).toMatch(/^\d\d × \d\d$/);
      ops.forEach((o) => expect(o >= 12 && o <= 49).toBe(true));
    });
    check(5, (_ops, p) => expect(p.prompt).toMatch(/^\d\d × \d \+ \d\d × \d\d$/));
  });

  it('no duplicate problems in a set (commutative duplicates included), even at difficulty 1 × 20', () => {
    for (let seed = 0; seed < 50; seed++) {
      const ps = generateMathProblems({ type: 'math', difficulty: 1, count: 20 }, createRng(seed));
      expect(ps).toHaveLength(20);
      const keys = ps.map((p) => parse(p).sort().join('+'));
      expect(new Set(keys).size).toBe(20);
    }
  });

  it('clamps out-of-range configs', () => {
    expect(generateMathProblems({ type: 'math', difficulty: 9 as MathDifficulty, count: 99 }, createRng(1))).toHaveLength(20);
    expect(generateMathProblems({ type: 'math', difficulty: 2, count: 0 }, createRng(1))).toHaveLength(1);
    expect(generateMathProblems({ type: 'math', difficulty: Number.NaN as MathDifficulty, count: Number.NaN }, createRng(1))).toHaveLength(1);
  });

  it('checkMathAnswer is lenient about formatting', () => {
    const p: MathProblem = { prompt: '', spoken: '', answer: 1234 };
    for (const ok of ['1234', ' 1234 ', '1,234', '1.234', '1 234', '1 234', "1'234", '+1234', '１２３４']) expect(checkMathAnswer(p, ok)).toBe(true);
    for (const bad of ['', '123', '12.34', '1234.5', 'abc', '12 34x', '1,2345']) expect(checkMathAnswer(p, bad)).toBe(false);
    expect(checkMathAnswer({ ...p, answer: -5 }, '−5')).toBe(true);
    expect(checkMathAnswer({ ...p, answer: 42 }, '4 2')).toBe(true);
  });
});

describe('memory', () => {
  it('round r highlights gridSize + r valid, sorted, unique cells, shown 1500 + 300/cell ms', () => {
    for (const gridSize of [3, 4, 5] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const rounds = generateMemoryRounds({ type: 'memory', gridSize, rounds: 5 }, createRng(seed));
        expect(rounds).toHaveLength(5);
        rounds.forEach((r, i) => {
          const n = Math.min(gridSize + i, gridSize * gridSize - 1);
          expect(r.gridSize).toBe(gridSize);
          expect(r.cells).toHaveLength(n);
          expect(new Set(r.cells).size).toBe(n);
          expect([...r.cells].sort((a, b) => a - b)).toEqual(r.cells);
          r.cells.forEach((c) => expect(c >= 0 && c < gridSize * gridSize).toBe(true));
          expect(r.showMs).toBe(MEMORY_SHOW_BASE_MS + MEMORY_SHOW_PER_CELL_MS * n);
        });
      }
    }
  });
  it('clamps configs', () => {
    expect(generateMemoryRounds({ type: 'memory', gridSize: 9 as 5, rounds: 0 }, createRng(1))).toEqual([expect.objectContaining({ gridSize: 5 })]);
    expect(generateMemoryRounds({ type: 'memory', gridSize: Number.NaN as 3, rounds: 2 }, createRng(1))[0]?.gridSize).toBe(3);
  });
  it('checkMemoryTap: any order, re-taps ignored, wrong cell fails', () => {
    const round = { gridSize: 3, cells: [1, 4, 8], showMs: 0 };
    expect(checkMemoryTap(round, [], 8)).toBe('progress');
    expect(checkMemoryTap(round, [8], 8)).toBe('ignored');
    expect(checkMemoryTap(round, [8], 1)).toBe('progress');
    expect(checkMemoryTap(round, [8, 1], 4)).toBe('complete');
    expect(checkMemoryTap(round, [8], 0)).toBe('wrong');
    expect(checkMemoryTap(round, [], 9)).toBe('ignored');
    expect(checkMemoryTap(round, [], -1)).toBe('ignored');
    expect(checkMemoryTap(round, [], 1.5)).toBe('ignored');
  });
});

describe('typing', () => {
  it('bundled phrases: enough, right length, unique, plain printable ASCII', () => {
    expect(SHORT_PHRASES.length).toBeGreaterThanOrEqual(40);
    expect(LONG_PHRASES.length).toBeGreaterThanOrEqual(20);
    for (const p of SHORT_PHRASES) expect(p.length >= 25 && p.length <= 60, p).toBe(true);
    for (const p of LONG_PHRASES) expect(p.length >= 80 && p.length <= 140, p).toBe(true);
    for (const p of [...SHORT_PHRASES, ...LONG_PHRASES]) {
      expect(p).toMatch(/^[\x20-\x7E]+$/);
      expect(normalizePhrase(p, true)).toBe(p); // already normalised: no double spaces, no edge spaces
    }
    expect(new Set([...SHORT_PHRASES, ...LONG_PHRASES]).size).toBe(SHORT_PHRASES.length + LONG_PHRASES.length);
  });
  it('pickPhrases: custom, random short, random long for 3+', () => {
    const t = defaultMissionConfig('typing');
    expect(pickPhrases({ ...t, phraseMode: 'custom', customPhrase: '  Up I get  ' }, createRng(1))).toEqual(['Up I get']);
    expect(pickPhrases({ ...t, phraseMode: 'custom', customPhrase: '   ' }, createRng(1))).toHaveLength(1); // never empty
    const two = pickPhrases({ ...t, phrases: 2 }, createRng(1));
    expect(two).toHaveLength(2);
    expect(new Set(two).size).toBe(2);
    two.forEach((p) => expect(SHORT_PHRASES).toContain(p));
    const five = pickPhrases({ ...t, phrases: 5 }, createRng(1));
    expect(new Set(five).size).toBe(5);
    five.forEach((p) => expect(LONG_PHRASES).toContain(p));
    expect(pickPhrases({ ...t, phrases: 99 }, createRng(1))).toHaveLength(5);
    expect(pickPhrases({ ...t, phrases: Number.NaN }, createRng(1))).toHaveLength(1);
    expect(pickPhrases({ ...t, phrases: 1 }, createRng(5))).toEqual(pickPhrases({ ...t, phrases: 1 }, createRng(5)));
  });
  it('normalizePhrase', () => {
    expect(normalizePhrase('  It’s  “fine” — ok… ', false)).toBe('it\'s "fine" - ok...');
    expect(normalizePhrase('A B\tC\nD', true)).toBe('A B C D');
    expect(normalizePhrase('Café', true)).toBe('Café');
  });
  it('comparePhrase reports matches and the correct prefix', () => {
    expect(comparePhrase('Hello world', 'hello  WORLD ', false)).toEqual({ matches: true, correctPrefixLength: 11 });
    expect(comparePhrase('Hello world', 'hello world', true)).toEqual({ matches: false, correctPrefixLength: 0 });
    expect(comparePhrase('Hello world', 'Hello wq', true)).toEqual({ matches: false, correctPrefixLength: 7 });
    expect(comparePhrase('Hello', '', false)).toEqual({ matches: false, correctPrefixLength: 0 });
    expect(comparePhrase('Hello', 'Hello there', false)).toEqual({ matches: false, correctPrefixLength: 5 });
  });
});

describe('tap', () => {
  it('targets stay inside the play area, below the top 15 %, and ≥ 0.25 apart', () => {
    for (let seed = 0; seed < 40; seed++) {
      const ts = generateTapTargets({ type: 'tap', targets: 60 }, createRng(seed));
      expect(ts).toHaveLength(60);
      ts.forEach((t, i) => {
        expect(t.id).toBe(i);
        expect(t.x - t.radius).toBeGreaterThanOrEqual(0);
        expect(t.x + t.radius).toBeLessThanOrEqual(1);
        expect(t.y - t.radius).toBeGreaterThanOrEqual(TAP_TOP_EXCLUDED);
        expect(t.y + t.radius).toBeLessThanOrEqual(1);
        expect(t.ttlMs).toBeGreaterThan(0);
        const prev = ts[i - 1];
        if (prev) expect(Math.hypot(t.x - prev.x, t.y - prev.y)).toBeGreaterThanOrEqual(TAP_MIN_DISTANCE);
      });
    }
  });
  it('keeps the distance guarantee even with a degenerate rng', () => {
    const ts = generateTapTargets({ type: 'tap', targets: 10 }, () => 0.5);
    for (let i = 1; i < ts.length; i++) expect(Math.hypot(ts[i]!.x - ts[i - 1]!.x, ts[i]!.y - ts[i - 1]!.y)).toBeGreaterThanOrEqual(TAP_MIN_DISTANCE);
  });
  it('clamps the target count', () => {
    expect(generateTapTargets({ type: 'tap', targets: 1 }, createRng(1))).toHaveLength(5);
    expect(generateTapTargets({ type: 'tap', targets: 1000 }, createRng(1))).toHaveLength(60);
    expect(generateTapTargets({ type: 'tap', targets: Number.NaN }, createRng(1))).toHaveLength(5);
  });
  it('isHit uses a 20 % tolerance in isotropic units', () => {
    const t = { id: 0, x: 0.5, y: 0.5, radius: 0.1, ttlMs: 1000 };
    // Portrait area, aspect 0.5 (w = h/2): radius = 0.1 × width = 0.05 heights.
    expect(isHit(t, 0.5, 0.5, 0.5)).toBe(true);
    expect(isHit(t, 0.5, 0.5 + 0.059, 0.5)).toBe(true); // within 1.2 × 0.05
    expect(isHit(t, 0.5, 0.5 + 0.061, 0.5)).toBe(false);
    expect(isHit(t, 0.5 + 0.119, 0.5, 0.5)).toBe(true); // horizontal fraction is of the (shorter) width
    expect(isHit(t, 0.5 + 0.121, 0.5, 0.5)).toBe(false);
    // Landscape, aspect 2: radius = 0.1 heights.
    expect(isHit(t, 0.5, 0.5 + 0.119, 2)).toBe(true);
    expect(isHit(t, 0.5 + 0.061, 0.5, 2)).toBe(false);
    expect(isHit(t, Number.NaN, 0.5, 1)).toBe(false);
    expect(isHit(t, 0.5, 0.5, 0)).toBe(false);
  });
});

describe('qr', () => {
  it('normalizeCode strips invisible chars and trailing newlines, NFC, trims, keeps case', () => {
    expect(normalizeCode('﻿  AbC​123\r\n')).toBe('AbC123');
    expect(normalizeCode('é')).toBe('é');
    expect(normalizeCode('a\nb')).toBe('a\nb');
  });
  it('codesMatch', () => {
    expect(codesMatch('ABC', ' ABC\r\n')).toBe(true);
    expect(codesMatch('ABC', 'abc')).toBe(false);
    expect(codesMatch('', '')).toBe(false);
    expect(codesMatch('​', '')).toBe(false);
  });
  it('describeCode shortens to at most 24 characters', () => {
    expect(describeCode('short')).toBe('short');
    const long = describeCode('https://example.com/some/long/path/3f9a');
    expect(long.length).toBeLessThanOrEqual(24);
    expect(long).toBe('https://example…ath/3f9a');
    expect(Array.from(describeCode('😀'.repeat(40))).length).toBe(24);
    expect(describeCode('a\u0000b')).toBe('a b');
  });
});
