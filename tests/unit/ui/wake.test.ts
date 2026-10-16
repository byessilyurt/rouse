import { describe, expect, it } from 'vitest';
import { circadianWake, missionWake } from '../../../src/ui/wake';

const at = (h: number, m = 0) => new Date(2026, 9, 16, h, m);

describe('circadianWake', () => {
  it('is lowest in the small hours and highest during the day', () => {
    expect(circadianWake(at(2))).toBeCloseTo(0.15);
    expect(circadianWake(at(4, 30))).toBeCloseTo(0.15);
    expect(circadianWake(at(13))).toBeCloseTo(0.7);
  });

  it('rises through the morning and falls through the evening', () => {
    expect(circadianWake(at(6))).toBeGreaterThan(circadianWake(at(5)));
    expect(circadianWake(at(8))).toBeCloseTo(0.65);
    expect(circadianWake(at(22))).toBeLessThan(circadianWake(at(20)));
  });

  it('puts night in the dark regime and day in the light one', () => {
    for (const h of [0, 1, 3, 23]) expect(circadianWake(at(h))).toBeLessThan(0.5);
    for (const h of [9, 12, 18]) expect(circadianWake(at(h))).toBeGreaterThanOrEqual(0.5);
  });

  it('is continuous at midnight', () => {
    expect(Math.abs(circadianWake(at(23, 59)) - circadianWake(at(0, 0)))).toBeLessThan(0.01);
  });
});

describe('missionWake', () => {
  it('climbs from 0.55 to 0.95 as missions are solved', () => {
    expect(missionWake(0, 3)).toBeCloseTo(0.55);
    expect(missionWake(1, 3)).toBeCloseTo(0.6833, 3);
    expect(missionWake(3, 3)).toBeCloseTo(0.95);
  });

  it('clamps out-of-range input', () => {
    expect(missionWake(-1, 2)).toBeCloseTo(0.55);
    expect(missionWake(5, 2)).toBeCloseTo(0.95);
    expect(missionWake(0, 0)).toBeCloseTo(0.95);
  });
});
