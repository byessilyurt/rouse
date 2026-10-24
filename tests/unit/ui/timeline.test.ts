import { describe, expect, it } from 'vitest';
import { markOffsets } from '../../../src/ui/screens/AlarmList';

describe('timeline markOffsets', () => {
  it('keeps marks at their time when far apart', () => {
    expect(markOffsets([100, 400], [120, 120])).toEqual([100, 400]);
  });

  it('pushes a near-time mark below the measured card above it', () => {
    // 1 min apart (0.5 px) with 130 px cards: each sits 130 + 12 below the previous.
    expect(markOffsets([60, 60.5, 61], [130, 130, 150])).toEqual([60, 202, 344]);
  });

  it('falls back to the minimum gap before cards are measured', () => {
    expect(markOffsets([60, 61], [])).toEqual([60, 144]);
  });
});
