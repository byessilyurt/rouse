/**
 * Bootstrap (plan §2.2): createBackend → RouseService.init → getActiveRing → route;
 * subscribe to ring / wake-check events; visibilitychange → health re-check.
 */
import { render } from 'preact';
import './ui/tokens.css';
import './ui/app.css';
import { createBackend } from './platform';
import type { ActiveRing, AlarmBackend } from './platform/AlarmBackend';
import { Repository } from './core/storage';
import { RouseService } from './core/service';
import { App, isLockedRoute } from './ui/App';
import { CapabilityStore } from './ui/capabilities';
import { RingManager } from './ui/ring/manager';
import { currentLocation, navigate } from './ui/router';
import { emitHealthChanged } from './ui/context';
import { BootError, BootSplash } from './ui/screens/Boot';
import { version } from '../package.json';

const root = document.getElementById('app')!;
const isE2E = /[?&]e2e=1\b/.test(location.search + location.hash);

function newId(): string {
  return crypto.randomUUID();
}

function ringPath(ring: ActiveRing): string {
  if (ring.isTest) return '/ring?test=1';
  if (ring.source === 'wake-check') return '/ring?reason=wakecheck';
  if (ring.source === 'safety' || ring.source === 'catch-up') return '/ring?reason=killed';
  return '/ring';
}

async function boot(): Promise<void> {
  render(<BootSplash />, root);
  let backend: AlarmBackend;
  try {
    backend = await createBackend();
    await backend.init();
    const now = () => Date.now();
    const repo = new Repository(localStorage, now);
    const service = new RouseService({ repo, backend, now, newId, appVersion: version });
    await service.init();
    const caps = new CapabilityStore({ testMode: isE2E });
    caps.start();
    const ring = new RingManager({ backend, service, repo, caps, now });

    backend.subscribe((ev) => {
      switch (ev.type) {
        case 'ring':
          ring.setRing(ev.ring);
          navigate(ringPath(ev.ring), { replace: isLockedRoute(currentLocation()) });
          break;
        case 'wake-check':
          ring.setRing(ev.ring);
          navigate('/wakecheck', { replace: isLockedRoute(currentLocation()) });
          break;
        case 'ring-state':
          ring.setRing(ev.ring);
          break;
        case 'health-changed':
          emitHealthChanged();
          break;
        case 'log':
          break; // RouseService applies the log itself.
      }
    });

    ring.onTerminal((info) => {
      if (info.kind === 'dismissed') navigate('/done', { replace: true });
      else if (info.kind === 'snoozed') navigate('/snoozed', { replace: true });
      else {
        const r = ring.getRing();
        if (r?.state === 'ringing') navigate(ringPath(r), { replace: true });
        else if (r?.state === 'wake-check-prompt') navigate('/wakecheck', { replace: true });
        else if (isLockedRoute(currentLocation())) navigate('/alarms', { replace: true });
      }
    });

    const active = await backend.getActiveRing();
    ring.setRing(active);
    if (active?.state === 'ringing') navigate(ringPath(active), { replace: true });
    else if (active?.state === 'wake-check-prompt') navigate('/wakecheck', { replace: true });
    else if (!service.getSettings().onboardingDone) {
      if (currentLocation().parts[0] !== 'onboarding') navigate('/onboarding/1', { replace: true });
    } else if (!location.hash || location.hash === '#' || location.hash === '#/' || isLockedRoute(currentLocation())) {
      navigate('/alarms', { replace: true });
    }

    render(<App deps={{ service, backend, repo, ring, caps, now, newId, appVersion: version }} />, root);
    document.documentElement.setAttribute('data-ready', '1');
  } catch (err) {
    console.error('[rouse] boot failed', err);
    render(<BootError onRetry={() => location.reload()} />, root);
  }
}

void boot();
