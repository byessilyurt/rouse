/**
 * Tiny hash router (design.md §2). `#/path?query`. Unknown hashes are mapped by the App to #/alarms.
 */
import { useEffect, useState } from 'preact/hooks';

export interface Location {
  /** Path without '#', e.g. "/alarm/new". */
  path: string;
  parts: string[];
  query: URLSearchParams;
  /** Full hash target ("/alarm/new?x=1"). */
  href: string;
}

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#/, '') || '/';
  const [p = '/', q = ''] = raw.split('?');
  const path = p.startsWith('/') ? p : `/${p}`;
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q), href: raw };
}

type Listener = (loc: Location, nav: NavKind) => void;
export type NavKind = 'push' | 'replace' | 'pop';
const listeners = new Set<Listener>();
/** How many in-app pushes are on the history stack (so Back knows whether history.back() stays in the app). */
let depth = 0;
let pendingKind: NavKind | null = null;
let installed = false;

export function currentLocation(): Location {
  return parseHash(typeof location === 'undefined' ? '' : location.hash);
}

function emit(kind: NavKind) {
  const loc = currentLocation();
  for (const l of [...listeners]) l(loc, kind);
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('hashchange', () => {
    const kind = pendingKind ?? 'pop';
    pendingKind = null;
    if (kind === 'pop') depth = Math.max(0, depth - 1);
    emit(kind);
  });
}

/** Navigate to a hash path ("/alarms"). replace=true does not add a history entry. */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  install();
  const target = to.startsWith('#') ? to : `#${to}`;
  if (location.hash === target) {
    emit('replace');
    return;
  }
  if (opts.replace) {
    const url = location.pathname + location.search + target;
    history.replaceState(history.state, '', url);
    emit('replace');
  } else {
    depth++;
    pendingKind = 'push';
    location.hash = target;
  }
}

/** Go back within the app; if there is nothing to go back to, replace with `fallback`. */
export function goBack(fallback: string): void {
  install();
  if (depth > 0) {
    history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}

export function onNavigate(listener: Listener): () => void {
  install();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocation(): [Location, NavKind] {
  const [state, setState] = useState<[Location, NavKind]>(() => [currentLocation(), 'replace']);
  useEffect(() => onNavigate((loc, kind) => setState([loc, kind])), []);
  return state;
}

/** Test helper: reset internal state. */
export function _resetRouter(): void {
  depth = 0;
  pendingKind = null;
}
