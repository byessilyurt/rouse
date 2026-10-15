/** Shake / steps / squat missions (design.md §3.7) fed by devicemotion samples (D-012). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ShakeMissionConfig, SquatMissionConfig, StepsMissionConfig } from '../../core/types';
import { createShakeDetector, createSquatDetector, createStepDetector, type RepDetector } from '../../missions/motion';
import { Button } from '../components/Button';
import { ProgressRing } from '../components/layout';
import { announce } from '../components/feedback';
import { useApp } from '../context';
import type { MissionProps } from './common';

type MotionConfig = ShakeMissionConfig | StepsMissionConfig | SquatMissionConfig;

const NO_EVENTS_MS = 5000;

export function MotionMission({ config, onSuccess, onActivity, onProgress, onUnavailable }: MissionProps<MotionConfig>) {
  const { caps } = useApp();
  const detector = useMemo<RepDetector>(() => {
    if (config.type === 'shake') return createShakeDetector(config.sensitivity);
    if (config.type === 'steps') return createStepDetector();
    return createSquatDetector();
  }, []);
  const total = config.count;
  const [count, setCount] = useState(0);
  const [silent, setSilent] = useState(false);
  const lastQuarter = useRef(0);
  const done = useRef(false);
  const gotSample = useRef(false);
  const cb = useRef({ onSuccess, onActivity, onUnavailable });
  cb.current = { onSuccess, onActivity, onUnavailable };

  useEffect(() => onProgress(Math.min(count, total), total), [count]);

  useEffect(() => {
    const unsub = caps.onSample((s) => {
      gotSample.current = true;
      setSilent(false);
      if (done.current) return;
      const n = detector.push(s);
      if (n > 0) {
        try {
          navigator.vibrate?.(15);
        } catch {
          /* ignore */
        }
        cb.current.onActivity();
        const c = Math.min(total, detector.count);
        setCount(c);
        const quarter = Math.floor((c / total) * 4);
        if (quarter > lastQuarter.current && c < total) {
          lastQuarter.current = quarter;
          announce(`${c} of ${total}`, 'polite');
        }
        if (c >= total && !done.current) {
          done.current = true;
          cb.current.onSuccess();
        }
      }
    });
    const t = setTimeout(() => {
      if (!gotSample.current) {
        setSilent(true);
        cb.current.onUnavailable('motion');
      }
    }, NO_EVENTS_MS);
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, []);

  const unit = config.type === 'steps' ? 'steps' : config.type === 'squat' ? 'squats' : '';
  const instruction =
    config.type === 'shake' ? 'Shake the phone hard' : config.type === 'steps' ? 'Walk around. Keep this screen on.' : 'Hold the phone to your chest and squat.';
  return (
    <div class="mission-content" style="align-items: center">
      <ProgressRing
        value={count}
        max={total}
        label={config.type === 'shake' ? 'Shakes' : config.type === 'steps' ? 'Steps' : 'Squats'}
        valueText={`${count} of ${total}${unit ? ` ${unit}` : ''}`}
        center={
          <>
            <span class="big" data-testid="motion-count">
              {count}
            </span>
            <span class="muted">
              of {total}
              {unit ? ` ${unit}` : ''}
            </span>
          </>
        }
      />
      <p class="center">{instruction}</p>
      {silent && (
        <div class="stack-sm center">
          {config.type !== 'shake' && <p>Rouse can't count {config.type === 'steps' ? 'steps' : 'squats'} on this phone right now.</p>}
          <Button
            variant="secondary"
            onClick={async () => {
              await caps.requestMotionPermission();
            }}
          >
            Allow motion sensor
          </Button>
        </div>
      )}
    </div>
  );
}
