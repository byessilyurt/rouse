/**
 * Health (Reliability) helpers shared by the alarm list pill, settings row, onboarding and #/health.
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { HealthCheck, HealthCheckId, HealthStatus } from '../platform/AlarmBackend';
import type { CheckStatus, Tone } from './components/layout';
import { onHealthChanged, useApp } from './context';

export function useHealth(): { health: HealthStatus | null; refreshing: boolean; refresh: () => Promise<void> } {
  const { backend } = useApp();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setHealth(await backend.getHealth());
    } catch {
      setHealth(null);
    } finally {
      setRefreshing(false);
    }
  }, [backend]);
  useEffect(() => {
    void refresh();
    return onHealthChanged(() => void refresh());
  }, [refresh]);
  return { health, refreshing, refresh };
}

export interface HealthSummary {
  tone: Tone;
  text: string;
  ariaLabel: string;
  issues: number;
}

export function summarizeHealth(h: HealthStatus | null, mismatches = 0): HealthSummary {
  if (!h) return { tone: 'info', text: 'Checking…', ariaLabel: 'Reliability: checking. Open reliability check', issues: 0 };
  if (h.platform === 'web') {
    return { tone: 'warn', text: 'Demo mode', ariaLabel: "Reliability: web demo, can't wake a locked phone. Open reliability check", issues: 0 };
  }
  const relevant = h.checks.filter((c) => c.severity !== 'optional' && c.state === 'action-needed');
  const critical = relevant.filter((c) => c.severity === 'critical').length;
  const issues = relevant.length + (mismatches > 0 ? 1 : 0);
  if (critical > 0) return { tone: 'error', text: "Can't ring", ariaLabel: "Reliability: can't ring. Open reliability check", issues };
  if (issues > 0) {
    const t = `${issues} ${issues === 1 ? 'issue' : 'issues'}`;
    return { tone: 'warn', text: t, ariaLabel: `Reliability: ${t}. Open reliability check`, issues };
  }
  return { tone: 'ok', text: 'Ready', ariaLabel: 'Reliability: ready. Open reliability check', issues: 0 };
}

export function findCheck(h: HealthStatus | null, id: HealthCheckId): HealthCheck | undefined {
  return h?.checks.find((c) => c.id === id);
}

/** Map a backend check to the CheckRow status vocabulary. */
export function checkStatus(c: HealthCheck | undefined, web: boolean): CheckStatus {
  if (!c) return web ? 'unsupported' : 'unknown';
  switch (c.state) {
    case 'ok':
      return 'ok';
    case 'unsupported':
      return web ? 'unsupported' : 'warn';
    case 'unknown':
      return 'unknown';
    case 'action-needed':
      return c.severity === 'critical' ? 'error' : 'warn';
  }
}
