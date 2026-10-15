import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { MathMission } from '../../../src/ui/missions/MathMission';
import { MemoryMission } from '../../../src/ui/missions/MemoryMission';
import { TypingMission } from '../../../src/ui/missions/TypingMission';
import { TapMission } from '../../../src/ui/missions/TapMission';
import { createRng } from '../../../src/missions/rng';
import { generateMathProblems } from '../../../src/missions/math';
import { generateMemoryRounds } from '../../../src/missions/memory';
import type { MathMissionConfig, MemoryMissionConfig } from '../../../src/core/types';
import { click, input, mount, type Rendered } from './render';

let r: Rendered | null = null;
afterEach(() => {
  r?.unmount();
  r = null;
  vi.useRealTimers();
});

const handlers = () => ({
  onSuccess: vi.fn(),
  onFailure: vi.fn(),
  onActivity: vi.fn(),
  onProgress: vi.fn(),
  onUnavailable: vi.fn(),
});

async function typeDigits(r: Rendered, digits: string) {
  for (const d of digits) await click(r.byRole('button', d));
}

describe('MathMission', () => {
  it('keeps the problem on a wrong answer, counts a failure, and succeeds after all problems', async () => {
    const cfg: MathMissionConfig = { type: 'math', difficulty: 2, count: 2 };
    const expected = generateMathProblems(cfg, createRng(7));
    const h = handlers();
    r = await mount(<MathMission config={cfg} rng={createRng(7)} practice={false} {...h} />);
    expect(r.byRole('group', 'Number pad')).toBeTruthy();
    expect(r.text()).toContain(`${expected[0]!.prompt} = ?`);
    expect(r.container.querySelector('.visually-hidden')!.textContent).toBe(expected[0]!.spoken);
    await typeDigits(r, '0');
    await click(r.byRole('button', 'Check answer'));
    expect(h.onFailure).toHaveBeenCalledTimes(1);
    expect(r.text()).toContain('Not quite. Try again.');
    expect(r.text()).toContain(`${expected[0]!.prompt} = ?`);
    expect((r.byRole('textbox', 'Your answer') as HTMLInputElement).value).toBe('');
    for (const p of expected) {
      await typeDigits(r, String(p.answer));
      await click(r.byRole('button', 'Check answer'));
    }
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
    expect(h.onActivity).toHaveBeenCalled();
    expect(h.onProgress).toHaveBeenCalledWith(2, 2);
  });

  it('works with a physical keyboard', async () => {
    const cfg: MathMissionConfig = { type: 'math', difficulty: 1, count: 1 };
    const [p] = generateMathProblems(cfg, createRng(3));
    const h = handlers();
    r = await mount(<MathMission config={cfg} rng={createRng(3)} practice={false} {...h} />);
    await act(() => {
      for (const d of String(p!.answer)) document.dispatchEvent(new KeyboardEvent('keydown', { key: d, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryMission', () => {
  it('shows a star on highlighted tiles, then uses aria-pressed; a wrong tap replays the round', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const cfg: MemoryMissionConfig = { type: 'memory', gridSize: 3, rounds: 1 };
    const [round] = generateMemoryRounds(cfg, createRng(11));
    const h = handlers();
    r = await mount(<MemoryMission config={cfg} rng={createRng(11)} practice={false} {...h} />);
    expect(r.text()).toContain('Remember these tiles');
    const lit = [...r.container.querySelectorAll('[data-lit="true"]')];
    expect(lit.map((e) => Number(e.getAttribute('data-cell')))).toEqual(round!.cells);
    expect(lit.every((e) => e.querySelector('svg'))).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(round!.showMs);
    });
    expect(r.text()).toContain('Tap the tiles you saw');
    const tiles = r.allByRole('button', /^Row \d, column \d$/);
    expect(tiles).toHaveLength(9);
    expect(tiles.every((t) => t.getAttribute('aria-pressed') === 'false')).toBe(true);
    const wrong = tiles.find((t) => !round!.cells.includes(Number(t.getAttribute('data-cell'))))!;
    await click(wrong);
    expect(h.onFailure).toHaveBeenCalledWith('wrong-tile');
    expect(r.text()).toContain("That one wasn't in the pattern. Watch again.");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(r.text()).toContain('Remember these tiles');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(round!.showMs + 200);
    });
    expect(r.text()).toContain('Tap the tiles you saw');
    for (const cell of round!.cells) {
      const tile = r.container.querySelector(`[data-cell="${cell}"]`)!;
      await click(tile);
      expect(tile.getAttribute('aria-pressed')).toBe('true');
    }
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('TypingMission', () => {
  it('blocks paste, marks the first mismatch with ▲, and accepts the phrase ignoring capitals', async () => {
    const h = handlers();
    r = await mount(
      <TypingMission config={{ type: 'typing', phraseMode: 'custom', customPhrase: 'Rise and shine', strictCase: false, phrases: 1 }} rng={createRng(1)} practice={false} {...h} />,
    );
    const box = r.byRole('textbox', 'Type the phrase') as HTMLTextAreaElement;
    expect(box.getAttribute('autocomplete')).toBe('off');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    await act(() => {
      box.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(r.text()).toContain("Type it, don't paste it.");
    expect(r.byRole('button', 'Check').getAttribute('aria-disabled')).toBe('true');
    await input(box, 'Rise and shime');
    await click(r.byRole('button', 'Check'));
    expect(h.onFailure).toHaveBeenCalledTimes(1);
    expect(r.text()).toContain('▲');
    await input(box, 'rise  and shine');
    await click(r.byRole('button', 'Check'));
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('TapMission', () => {
  it('shows one labelled target at a time and finishes after all targets', async () => {
    const h = handlers();
    r = await mount(<TapMission config={{ type: 'tap', targets: 5 }} rng={createRng(5)} practice={false} {...h} />);
    for (let k = 1; k <= 5; k++) {
      expect(r.allByRole('button')).toHaveLength(1);
      await click(r.byRole('button', `Target ${k}`));
    }
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });
});
