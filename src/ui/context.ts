/**
 * App-wide dependencies and small hooks.
 */
import { createContext } from 'preact';
import { useContext, useEffect, useReducer, useState } from 'preact/hooks';
import type { AlarmBackend } from '../platform/AlarmBackend';
import type { RouseService } from '../core/service';
import type { Repository } from '../core/storage';
import type { EpochMs } from '../core/types';
import type { CapabilityStore } from './capabilities';
import type { RingManager } from './ring/manager';
import { resolveUse24h } from './format';

export interface AppDeps {
  service: RouseService;
  backend: AlarmBackend;
  repo: Repository;
  ring: RingManager;
  caps: CapabilityStore;
  now: () => EpochMs;
  newId: () => string;
  appVersion: string;
}

export const AppContext = createContext<AppDeps | null>(null);

export function useApp(): AppDeps {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}

/** Re-render on any service change; returns the service. */
export function useService(): RouseService {
  const { service } = useApp();
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => service.subscribe(() => force(0)), [service]);
  return service;
}

/** Re-render on ring manager changes. */
export function useRingManager(): RingManager {
  const { ring } = useApp();
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => ring.subscribe(() => force(0)), [ring]);
  return ring;
}

export function useCaps() {
  const { caps } = useApp();
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => caps.subscribe(() => force(0)), [caps]);
  return caps;
}

/** Current time, refreshed every `intervalMs`. */
export function useNow(intervalMs: number): EpochMs {
  const { now } = useApp();
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now();
}

export function useUse24h(): boolean {
  const service = useService();
  return resolveUse24h(service.getSettings().clockFormat);
}

/** Simple event bus for "health may have changed" (backend health-changed, visibilitychange). */
const healthListeners = new Set<() => void>();
export function emitHealthChanged(): void {
  for (const l of healthListeners) l();
}
export function onHealthChanged(l: () => void): () => void {
  healthListeners.add(l);
  return () => healthListeners.delete(l);
}
