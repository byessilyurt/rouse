/** Tap mission (design.md §3.7 Tap): one 72 px target at a time; focus follows the target. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TapMissionConfig } from '../../core/types';
import { generateTapTargets } from '../../missions/tap';
import { Icon } from '../icons';
import type { MissionProps } from './common';

export function TapMission({ config, rng, onSuccess, onActivity, onProgress }: MissionProps<TapMissionConfig>) {
  const targets = useMemo(() => generateTapTargets(config, rng), []);
  const [k, setK] = useState(0);
  const [moved, setMoved] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  const target = targets[k];

  useEffect(() => onProgress(Math.min(k, targets.length), targets.length), [k]);

  // A target that isn't hit in time moves (a miss, not a failure).
  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => setMoved({ x: 0.1 + rng() * 0.8, y: 0.2 + rng() * 0.7 }), target.ttlMs);
    return () => clearTimeout(t);
  }, [k, moved]);

  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('.tap-arena')) {
      if (k === 0 && !moved) return; // don't steal focus on mount
    }
    btnRef.current?.focus({ preventScroll: true });
  }, [k, moved]);

  if (!target) return null;
  const x = moved?.x ?? target.x;
  const y = moved?.y ?? target.y;
  const hit = () => {
    onActivity();
    if (done.current) return;
    const next = k + 1;
    setMoved(null);
    if (next >= targets.length) {
      done.current = true;
      onProgress(targets.length, targets.length);
      onSuccess();
    } else setK(next);
  };
  return (
    <div class="mission-content">
      <p class="center" aria-live="off">
        {k} of {targets.length}
      </p>
      <div class="tap-arena" data-testid="tap-arena">
        <button
          ref={btnRef}
          type="button"
          class="tap-target"
          aria-label={`Target ${k + 1}`}
          data-testid="tap-target"
          style={`left: clamp(44px, ${(x * 100).toFixed(2)}%, calc(100% - 44px)); top: clamp(44px, ${(y * 100).toFixed(2)}%, calc(100% - 44px))`}
          onClick={hit}
        >
          <Icon name="plus" size={32} />
        </button>
      </div>
    </div>
  );
}
