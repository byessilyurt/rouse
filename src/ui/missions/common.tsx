/** Shared mission-play types and the failure feedback line (design.md §3.7). */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Rng } from '../../missions/rng';
import { announce } from '../components/feedback';
import { Icon } from '../icons';

export interface MissionProps<C> {
  config: C;
  rng: Rng;
  practice: boolean;
  onSuccess: () => void;
  onFailure: (reason: string) => void;
  onActivity: () => void;
  /** Step progress for the top strip ("2 of 3"). */
  onProgress: (done: number, total: number) => void;
  /** Hardware / permission missing: offer the backup mission right away. */
  onUnavailable: (reason: string) => void;
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Visible + assertive failure message with a short horizontal shake (none with reduced motion). */
export function useFeedback(): [ { text: string | null; key: number }, (text: string | null) => void ] {
  const [fb, setFb] = useState<{ text: string | null; key: number }>({ text: null, key: 0 });
  const set = (text: string | null) => {
    setFb((f) => ({ text, key: f.key + 1 }));
    if (text) announce(text, 'assertive');
  };
  return [fb, set];
}

export function Feedback({ text, k }: { text: string | null; k: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !text) return;
    el.classList.remove('shake-x');
    void el.offsetWidth;
    el.classList.add('shake-x');
  }, [k]);
  return (
    <p class="feedback" ref={ref} data-testid="mission-feedback">
      {text && (
        <>
          <Icon name="x-octagon" size={20} />
          <span>{text}</span>
        </>
      )}
    </p>
  );
}
