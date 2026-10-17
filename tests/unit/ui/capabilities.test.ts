import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityStore } from '../../../src/ui/capabilities';

describe('CapabilityStore.forRing', () => {
  afterEach(() => vi.useRealTimers());

  it('counts sensors still being probed as present (a ring cold-starts the app)', () => {
    const caps = new CapabilityStore();
    expect(caps.get()).toEqual({ motion: false, camera: false });
    expect(caps.forRing()).toEqual({ motion: true, camera: true });
  });

  it('reports motion missing once the probe ends without an event', () => {
    vi.useFakeTimers();
    const caps = new CapabilityStore({ testMode: true });
    caps.start(1000);
    expect(caps.forRing().motion).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(caps.forRing().motion).toBe(false);
    caps.stop();
  });

  it('reports motion present after a devicemotion event', () => {
    vi.useFakeTimers();
    const caps = new CapabilityStore({ testMode: true });
    caps.start(1000);
    const ev = Object.assign(new Event('devicemotion'), { accelerationIncludingGravity: { x: 0, y: 9.8, z: 0 } });
    window.dispatchEvent(ev);
    vi.advanceTimersByTime(1000);
    expect(caps.forRing().motion).toBe(true);
    caps.stop();
  });
});
