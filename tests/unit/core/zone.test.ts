import { describe, expect, it } from 'vitest';
import { ianaZone, localZone } from '../../../src/core/zone';
import { iso } from './testUtils';

describe('ianaZone', () => {
  it.each([
    ['America/New_York', '2026-01-15T12:00:00Z', -300],
    ['America/New_York', '2026-07-15T12:00:00Z', -240],
    ['Europe/Berlin', '2026-01-15T12:00:00Z', 60],
    ['Europe/Berlin', '2026-07-15T12:00:00Z', 120],
    ['Asia/Kolkata', '2026-07-15T12:00:00Z', 330],
    ['Australia/Lord_Howe', '2026-07-15T12:00:00Z', 630],
    ['Australia/Lord_Howe', '2026-12-15T12:00:00Z', 660],
    ['America/Santiago', '2026-07-15T12:00:00Z', -240],
    ['America/Santiago', '2026-12-15T12:00:00Z', -180],
    ['Asia/Kathmandu', '2026-07-15T12:00:00Z', 345],
    ['UTC', '2026-07-15T12:00:00Z', 0],
  ])('%s at %s is %i min', (zone, at, offset) => {
    expect(ianaZone(zone)(iso(at))).toBe(offset);
  });

  it('switches exactly at the transition instant (NY spring forward 2026-03-08 07:00Z)', () => {
    const ny = ianaZone('America/New_York');
    expect(ny(iso('2026-03-08T06:59:59.999Z'))).toBe(-300);
    expect(ny(iso('2026-03-08T07:00:00Z'))).toBe(-240);
  });

  it('ignores sub-second parts and handles pre-1970 instants', () => {
    const berlin = ianaZone('Europe/Berlin');
    expect(berlin(iso('2026-01-01T00:00:00.999Z'))).toBe(60);
    expect(berlin(iso('1960-01-01T00:00:00Z'))).toBe(60);
  });

  it('caches per zone and rejects unknown zones', () => {
    expect(ianaZone('Europe/Berlin')).toBe(ianaZone('Europe/Berlin'));
    expect(() => ianaZone('Not/AZone')).toThrow(RangeError);
  });

  it('localZone matches Date#getTimezoneOffset', () => {
    const t = iso('2026-05-01T00:00:00Z');
    expect(localZone(t)).toBe(-new Date(t).getTimezoneOffset());
  });
});
