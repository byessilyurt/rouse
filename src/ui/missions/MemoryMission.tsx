/** Memory mission (design.md §3.7 Memory): show phase with star glyphs, recall phase with aria-pressed tiles. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MemoryMissionConfig } from '../../core/types';
import { checkMemoryTap, generateMemoryRounds } from '../../missions/memory';
import { announce } from '../components/feedback';
import { Icon } from '../icons';
import { Feedback, useFeedback, type MissionProps } from './common';

const pos = (cell: number, size: number) => ({ r: Math.floor(cell / size) + 1, c: (cell % size) + 1 });

export function MemoryMission({ config, rng, onSuccess, onFailure, onActivity, onProgress }: MissionProps<MemoryMissionConfig>) {
  const rounds = useMemo(() => generateMemoryRounds(config, rng), []);
  const [r, setR] = useState(0);
  const [phase, setPhase] = useState<'show' | 'recall'>('show');
  const [selected, setSelected] = useState<number[]>([]);
  const [wrong, setWrong] = useState<number | null>(null);
  const [fb, setFb] = useFeedback();
  const [showKey, setShowKey] = useState(0);
  const done = useRef(false);
  const round = rounds[r];

  useEffect(() => onProgress(Math.min(r + 1, rounds.length), rounds.length), [r]);

  // Show phase: highlight, announce positions, then switch to recall.
  useEffect(() => {
    if (!round || phase !== 'show') return;
    const size = round.gridSize;
    announce(
      `Remember these tiles: ${round.cells
        .map((cell) => {
          const p = pos(cell, size);
          return `row ${p.r}, column ${p.c}`;
        })
        .join('; ')}.`,
      'polite',
    );
    const t = setTimeout(() => {
      setPhase('recall');
      setSelected([]);
      setWrong(null);
    }, round.showMs);
    return () => clearTimeout(t);
  }, [r, phase, showKey]);

  if (!round) return null;
  const size = round.gridSize;

  const tap = (cell: number) => {
    onActivity();
    if (phase !== 'recall' || done.current || wrong !== null) return;
    const res = checkMemoryTap(round, selected, cell);
    if (res === 'ignored') return;
    if (res === 'wrong') {
      setWrong(cell);
      setFb("That one wasn't in the pattern. Watch again.");
      onFailure('wrong-tile');
      setTimeout(() => {
        setWrong(null);
        setSelected([]);
        setPhase('show');
        setShowKey((k) => k + 1);
      }, 1200);
      return;
    }
    const next = [...selected, cell];
    setSelected(next);
    if (res === 'complete') {
      setFb(null);
      if (r + 1 >= rounds.length) {
        done.current = true;
        onSuccess();
      } else {
        setTimeout(() => {
          setR(r + 1);
          setPhase('show');
          setSelected([]);
        }, 400);
      }
    }
  };

  return (
    <div class="mission-content">
      <h2 class="center">{phase === 'show' ? 'Remember these tiles' : 'Tap the tiles you saw'}</h2>
      <p class="center muted" aria-live="off">
        {phase === 'recall' ? `${selected.length} of ${round.cells.length}` : `${round.cells.length} tiles`}
      </p>
      <div class="memory-grid" style={`grid-template-columns: repeat(${size}, 1fr)`} role="group" aria-label="Tiles" data-phase={phase}>
        {Array.from({ length: size * size }, (_, cell) => {
          const p = pos(cell, size);
          const lit = phase === 'show' && round.cells.includes(cell);
          const picked = selected.includes(cell);
          const isWrong = wrong === cell;
          const cls = ['memory-tile', lit ? 'lit' : '', isWrong ? 'wrong' : ''].filter(Boolean).join(' ');
          return (
            <button
              key={cell}
              type="button"
              class={cls}
              data-cell={cell}
              data-lit={lit ? 'true' : undefined}
              aria-label={`Row ${p.r}, column ${p.c}${lit ? ', highlighted' : ''}`}
              aria-pressed={phase === 'recall' ? (picked ? 'true' : 'false') : undefined}
              aria-disabled={phase === 'show' ? 'true' : undefined}
              onClick={() => tap(cell)}
            >
              {lit && <Icon name="star" size={28} />}
              {picked && <Icon name="check" size={28} />}
              {isWrong && <Icon name="x" size={28} />}
            </button>
          );
        })}
      </div>
      <Feedback text={fb.text} k={fb.key} />
    </div>
  );
}
