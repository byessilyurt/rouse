/** Math mission (design.md §3.7 Math): custom keypad, physical keyboard works too. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MathMissionConfig } from '../../core/types';
import { checkMathAnswer, generateMathProblems } from '../../missions/math';
import { Keypad } from '../components/controls';
import { Feedback, useFeedback, type MissionProps } from './common';

export function MathMission({ config, rng, onSuccess, onFailure, onActivity, onProgress }: MissionProps<MathMissionConfig>) {
  const problems = useMemo(() => generateMathProblems(config, rng), []);
  const [i, setI] = useState(0);
  const [input, setInput] = useState('');
  const [fb, setFb] = useFeedback();
  const state = useRef({ i, input });
  const done = useRef(false);

  useEffect(() => onProgress(Math.min(i + 1, problems.length), problems.length), [i]);

  const setValue = (v: string) => {
    state.current = { ...state.current, input: v };
    setInput(v);
  };
  const digit = (d: string) => {
    onActivity();
    const v = state.current.input;
    if (v.length < 7) setValue(v + d);
  };
  const del = () => {
    onActivity();
    setValue(state.current.input.slice(0, -1));
  };
  const enter = () => {
    onActivity();
    const { i: idx, input: value } = state.current;
    const p = problems[idx];
    if (!p || done.current || value === '') return;
    if (checkMathAnswer(p, value)) {
      setFb(null);
      setValue('');
      if (idx + 1 >= problems.length) {
        done.current = true;
        onSuccess();
      } else {
        state.current = { i: idx + 1, input: '' };
        setI(idx + 1);
      }
    } else {
      setValue('');
      setFb('Not quite. Try again.');
      onFailure('wrong-answer');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return; // let buttons activate
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        digit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        del();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        enter();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const p = problems[i];
  if (!p) return null;
  return (
    <div class="mission-content">
      <h2 class="problem" data-testid="math-problem">
        <span aria-hidden="true">{p.prompt} = ?</span>
        <span class="visually-hidden">{p.spoken}</span>
      </h2>
      <input class="answer-box" readOnly inputMode="none" aria-label="Your answer" aria-live="off" value={input} data-testid="math-answer" />
      <Feedback text={fb.text} k={fb.key} />
      <Keypad onDigit={digit} onDelete={del} onEnter={enter} />
    </div>
  );
}
