import { describe, expect, it } from 'vitest';
import { parseSettings } from '../../../src/core/validation';
import { defaultSettings } from '../../../src/core/defaults';
import { ACCENTS, RING_COLORS, accentById, paletteVars, ringById } from '../../../src/ui/palette';

describe('palette', () => {
  it('has six accents and six ring colours with unique ids', () => {
    expect(new Set(ACCENTS.map((a) => a.id)).size).toBe(6);
    expect(new Set(RING_COLORS.map((r) => r.id)).size).toBe(6);
  });

  it('defaults to violet and lime', () => {
    expect(defaultSettings()).toMatchObject({ accent: 'violet', ringColor: 'lime' });
  });

  it('keeps valid choices and falls back for unknown ones', () => {
    expect(parseSettings({ accent: 'teal', ringColor: 'cyan' })).toMatchObject({ accent: 'teal', ringColor: 'cyan' });
    expect(parseSettings({ accent: 'orange', ringColor: 42 })).toMatchObject({ accent: 'violet', ringColor: 'lime' });
  });

  it('maps a choice to CSS variables for both regimes and the ring screen', () => {
    const v = paletteVars('teal', 'yellow');
    expect(v['--n1-accent']).toBe(accentById('teal').n1[0]);
    expect(v['--d1-accent']).toBe(accentById('teal').d1[0]);
    expect(v['--signal']).toBe(ringById('yellow').signal);
    expect(Object.keys(v)).toHaveLength(15);
  });

  it('never ships an orange hue', () => {
    const hue = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min < 0.15) return null; // greys have no meaningful hue
      const d = max - min;
      const deg = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (deg * 60 + 360) % 360;
    };
    const colours = [...ACCENTS.flatMap((a) => [...a.n0, ...a.n1, ...a.d0, ...a.d1]), ...RING_COLORS.map((r) => r.signal)];
    for (const c of colours) {
      const h = hue(c);
      if (h !== null) expect(h < 15 || h > 45, `${c} hue ${h?.toFixed(0)}`).toBe(true);
    }
  });
});
