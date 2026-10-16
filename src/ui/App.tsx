/**
 * Root component: hash routes (design.md §2), route-change contract (title, focus, scroll),
 * locked-route guards while ringing, theme application, live regions.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { AppContext, emitHealthChanged, useApp, useRingManager, useService, type AppDeps } from './context';
import { circadianWake, getWakeOverride, subscribeWake } from './wake';
import { LiveRegions } from './components/feedback';
import { navigate, useLocation, type Location } from './router';
import { Onboarding } from './screens/Onboarding';
import { AlarmList } from './screens/AlarmList';
import { AlarmEditor } from './screens/AlarmEditor';
import { MissionPicker } from './screens/MissionPicker';
import { MissionConfigScreen } from './screens/MissionConfig';
import { QrRegister } from './screens/QrRegister';
import { RingScreen } from './screens/Ring';
import { MissionPlayScreen, PracticeScreen } from './screens/MissionPlay';
import { FallbackScreen } from './screens/Fallback';
import { SnoozedScreen } from './screens/Snoozed';
import { DoneScreen } from './screens/Done';
import { WakeCheckScreen } from './screens/WakeCheck';
import { HealthScreen } from './screens/Health';
import { StatsScreen } from './screens/Stats';
import { SettingsScreen } from './screens/Settings';
import { LicencesScreen } from './screens/Licences';

export type RouteMatch =
  | { name: 'onboarding'; step: 1 | 2 | 3 }
  | { name: 'alarms' }
  | { name: 'editor'; id: string }
  | { name: 'picker'; id: string }
  | { name: 'missionConfig'; id: string; index: number; type: string | null }
  | { name: 'qr'; id: string; index: number; test: boolean }
  | { name: 'practice'; id: string; index: number }
  | { name: 'ring' }
  | { name: 'mission'; step: number; snooze: boolean }
  | { name: 'fallback' }
  | { name: 'snoozed' }
  | { name: 'done' }
  | { name: 'wakecheck' }
  | { name: 'health' }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'licences' }
  | { name: 'unknown' };

export function matchRoute(loc: Location): RouteMatch {
  const p = loc.parts;
  const int = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : NaN);
  switch (p[0]) {
    case 'onboarding': {
      const step = p[1] === undefined ? 1 : int(p[1]);
      return step === 1 || step === 2 || step === 3 ? { name: 'onboarding', step } : { name: 'unknown' };
    }
    case 'alarms':
      return p.length === 1 ? { name: 'alarms' } : { name: 'unknown' };
    case 'alarm': {
      const id = p[1];
      if (!id) return { name: 'unknown' };
      if (p.length === 2) return { name: 'editor', id };
      if (p[2] !== 'missions') return { name: 'unknown' };
      if (p.length === 3) return { name: 'picker', id };
      const index = int(p[3]);
      if (Number.isNaN(index) || index > 3) return { name: 'unknown' };
      if (p.length === 4) return { name: 'missionConfig', id, index, type: loc.query.get('type') };
      if (p.length === 5 && p[4] === 'qr') return { name: 'qr', id, index, test: loc.query.get('test') === '1' };
      if (p.length === 5 && p[4] === 'try') return { name: 'practice', id, index };
      return { name: 'unknown' };
    }
    case 'ring':
      if (p.length === 1) return { name: 'ring' };
      if (p[1] === 'mission' && p.length === 3 && !Number.isNaN(int(p[2]))) return { name: 'mission', step: int(p[2]), snooze: loc.query.get('snooze') === '1' };
      if (p[1] === 'fallback' && p.length === 2) return { name: 'fallback' };
      return { name: 'unknown' };
    case 'snoozed':
      return { name: 'snoozed' };
    case 'done':
      return { name: 'done' };
    case 'wakecheck':
      return { name: 'wakecheck' };
    case 'health':
      return { name: 'health' };
    case 'stats':
      return { name: 'stats' };
    case 'settings':
      if (p.length === 1) return { name: 'settings' };
      if (p[1] === 'licences' && p.length === 2) return { name: 'licences' };
      return { name: 'unknown' };
    default:
      return { name: 'unknown' };
  }
}

const LOCKED = new Set(['ring', 'mission', 'fallback', 'wakecheck']);
const RING_ROUTES = new Set(['ring', 'mission', 'fallback']);

export function isLockedRoute(loc: Location): boolean {
  return LOCKED.has(matchRoute(loc).name);
}

function renderRoute(m: RouteMatch): ComponentChildren {
  switch (m.name) {
    case 'onboarding':
      return <Onboarding step={m.step} />;
    case 'alarms':
      return <AlarmList />;
    case 'editor':
      return <AlarmEditor id={m.id} />;
    case 'picker':
      return <MissionPicker id={m.id} />;
    case 'missionConfig':
      return <MissionConfigScreen id={m.id} index={m.index} type={m.type} />;
    case 'qr':
      return <QrRegister id={m.id} index={m.index} test={m.test} />;
    case 'practice':
      return <PracticeScreen id={m.id} index={m.index} />;
    case 'ring':
      return <RingScreen />;
    case 'mission':
      return <MissionPlayScreen step={m.step} />;
    case 'fallback':
      return <FallbackScreen />;
    case 'snoozed':
      return <SnoozedScreen />;
    case 'done':
      return <DoneScreen />;
    case 'wakecheck':
      return <WakeCheckScreen />;
    case 'health':
      return <HealthScreen />;
    case 'stats':
      return <StatsScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'licences':
      return <LicencesScreen />;
    case 'unknown':
      return null;
  }
}

function Routes() {
  const [loc, kind] = useLocation();
  const service = useService();
  const ringMgr = useRingManager();
  const match = matchRoute(loc);
  const ring = ringMgr.getRing();
  const settings = service.getSettings();
  const listScroll = useRef(0);
  const lastName = useRef<string | null>(null);

  // Guards: unknown → alarms; onboarding first; locked while ringing.
  let redirect: string | null = null;
  if (ringMgr.needsRingUi() && !RING_ROUTES.has(match.name)) {
    redirect = '/ring';
  } else if (ring?.state === 'wake-check-prompt' && match.name !== 'wakecheck' && !RING_ROUTES.has(match.name)) {
    redirect = '/wakecheck';
  } else if (match.name === 'unknown') {
    redirect = '/alarms';
  } else if (!settings.onboardingDone && !LOCKED.has(match.name) && !['onboarding', 'editor', 'picker', 'missionConfig', 'qr', 'practice', 'licences', 'done', 'snoozed'].includes(match.name)) {
    redirect = '/onboarding/1';
  }

  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect, loc.href]);

  // Route-change contract: focus the screen's H1 (or [data-initial-focus]), scroll to top
  // except when returning to the list.
  useEffect(() => {
    if (redirect) return;
    const prev = lastName.current;
    lastName.current = match.name;
    if (prev === 'alarms' && match.name !== 'alarms') {
      // remembered in the scroll listener below
    }
    const t = setTimeout(() => {
      // A modal that opened since the navigation (e.g. a dialog raised right after a route change) has
      // already taken focus; moving it to the H1 would drop focus out of the dialog's trap.
      const modalOpen = document.querySelector('[aria-modal="true"]') !== null;
      const el = modalOpen ? null :
        document.querySelector<HTMLElement>('[data-initial-focus]') ??
        document.querySelector<HTMLElement>('main h1[tabindex="-1"], header h1[tabindex="-1"]');
      el?.focus({ preventScroll: true });
      if (match.name === 'alarms' && kind === 'pop') window.scrollTo(0, listScroll.current);
      else window.scrollTo(0, 0);
    }, 0);
    return () => clearTimeout(t);
  }, [loc.path, redirect]);

  useEffect(() => {
    if (match.name !== 'alarms') return;
    const onScroll = () => {
      listScroll.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [match.name]);

  // Locked routes: keep the screen on (best effort).
  const locked = LOCKED.has(match.name);
  useEffect(() => {
    if (!locked) return;
    let lock: { release(): Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock
      ?.request('screen')
      .then((l) => {
        if (cancelled) void l.release();
        else lock = l;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void lock?.release().catch(() => undefined);
    };
  }, [locked]);

  if (redirect) return null;
  return <>{renderRoute(match)}</>;
}

/** Applies --wake and the colour regime (data-theme) to <html> (design-language.md §1). */
function ThemeSync() {
  const service = useService();
  const { now } = useApp();
  const theme = service.getSettings().theme;
  // Layout effect: set the regime before the first paint so the app never flashes the wrong one.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const apply = () => {
      const wake = getWakeOverride() ?? circadianWake(new Date(now()));
      root.style.setProperty('--wake', wake.toFixed(3));
      const resolved =
        theme === 'wake' ? (wake >= 0.5 ? 'light' : 'dark') : theme === 'system' ? (mq?.matches === false ? 'light' : 'dark') : theme;
      root.setAttribute('data-theme', resolved);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || (resolved === 'light' ? '#fffaf2' : '#15110f'));
    };
    apply();
    const unsub = subscribeWake(apply);
    const tick = setInterval(apply, 60_000);
    if (theme === 'system') mq?.addEventListener?.('change', apply);
    return () => {
      unsub();
      clearInterval(tick);
      mq?.removeEventListener?.('change', apply);
    };
  }, [theme, now]);
  return null;
}

export function App({ deps }: { deps: AppDeps }) {
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') emitHealthChanged();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  return (
    <AppContext.Provider value={deps}>
      <ThemeSync />
      <LiveRegions />
      <Routes />
    </AppContext.Provider>
  );
}
