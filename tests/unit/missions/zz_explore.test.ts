import { it } from 'vitest';
import { createShakeDetector, createSquatDetector, createStepDetector } from '../../../src/missions/motion';
import { createRng } from '../../../src/missions/rng';
import { feed, shaking, squats, walking } from './motionSignals';
it('explore', () => {
  for (const hz of [15, 30, 60, 120]) {
    const row: string[] = [];
    for (const stepHz of [1.4, 1.8, 2.3]) {
      const d = createStepDetector();
      const n = feed(d, walking({ stepHz, durationMs: 20000, sampleHz: hz, rng: createRng(hz * 10 + stepHz * 10) }));
      row.push(`walk${stepHz}=${n}/${Math.round(stepHz * 20)}`);
    }
    for (const amp of [5, 10, 15, 25]) {
      let worst = 0;
      for (let seed = 0; seed < 10; seed++) {
        const d = createStepDetector();
        worst = Math.max(worst, feed(d, shaking({ durationMs: 30000, sampleHz: hz, amp, rng: createRng(seed) })));
      }
      row.push(`shake${amp}=${worst}`);
    }
    const sq = [1500, 2200, 3000].map((p) => feed(createSquatDetector(), squats({ reps: 10, periodMs: p, sampleHz: hz, rng: createRng(p) })));
    const sqShake = feed(createSquatDetector(), shaking({ durationMs: 30000, sampleHz: hz, amp: 15, rng: createRng(3) }));
    const sqWalk = feed(createSquatDetector(), walking({ stepHz: 1.8, durationMs: 20000, sampleHz: hz, rng: createRng(3) }));
    const shk = [10, 15, 25].map((amp) => feed(createShakeDetector('medium'), shaking({ durationMs: 10000, sampleHz: hz, amp, rng: createRng(1) })));
    const shkWalk = feed(createShakeDetector('low'), walking({ stepHz: 1.8, durationMs: 20000, sampleHz: hz, rng: createRng(3) }));
    console.log(hz, row.join(' '), 'squat', sq, 'sqShake', sqShake, 'sqWalk', sqWalk, 'shake', shk, 'shakeWalk', shkWalk);
  }
});
