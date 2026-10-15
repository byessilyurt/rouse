/**
 * Shared formatter for "Copy diagnostics" (plan §3). Both backends gather their own facts and
 * hand them to formatDiagnostics, so the report looks the same everywhere. Privacy by construction:
 * the input type has no field for alarm labels, QR codes, phrases or file names, and an active
 * ring is reduced to its state, source and counters.
 */
import type { ActiveRing, HealthStatus } from './AlarmBackend';
import type { EpochMs, NextFire } from '../core/types';

export interface DiagnosticsInput {
  platform: 'android' | 'web';
  generatedAt: EpochMs;
  health: HealthStatus | null;
  next: NextFire | null;
  ring: ActiveRing | null;
  pendingTestAt: EpochMs | null;
  /** Extra "key: value" facts (user agent, log summary…). */
  facts?: readonly string[];
  /** Backend diagnostic lines (native: the DiagLog ring buffer, oldest first). */
  lines?: readonly string[];
  /** Sections that could not be read, e.g. 'health'. Reported instead of failing the whole report. */
  unavailable?: readonly string[];
}

const iso = (t: EpochMs): string => new Date(t).toISOString();

export function formatDiagnostics(d: DiagnosticsInput): string {
  const out: string[] = [];
  out.push(`Rouse diagnostics · ${d.platform} · ${iso(d.generatedAt)}`);
  for (const f of d.facts ?? []) out.push(f);

  out.push('', '[health]');
  if (d.health) {
    out.push(`sdk: ${d.health.sdkInt ?? 'n/a'} · maker: ${d.health.manufacturer ?? 'n/a'} · checked: ${iso(d.health.checkedAt)}`);
    for (const c of d.health.checks) out.push(`${c.id}: ${c.state} (${c.severity})`);
  } else {
    out.push('unavailable');
  }

  out.push('', '[scheduled]');
  out.push(d.next ? `next fire: ${iso(d.next.fireAt)} (${d.next.alarmIds.length} ${d.next.alarmIds.length === 1 ? 'alarm' : 'alarms'})` : 'next fire: none');
  out.push(d.pendingTestAt != null ? `pending test: ${iso(d.pendingTestAt)}` : 'pending test: none');
  if (d.ring) {
    const r = d.ring;
    out.push(
      `episode: ${r.state} · source ${r.source} · test ${r.isTest} · snoozes ${r.snoozeCount} · wake-check re-rings ${r.wakeCheckReRings}` +
        ` · silenced ${r.silenced} · native fallback ${r.nativeFallbackShown}`,
    );
  } else {
    out.push('episode: none');
  }

  if (d.lines && d.lines.length > 0) {
    out.push('', `[log] last ${d.lines.length} lines`);
    out.push(...d.lines);
  }
  if (d.unavailable && d.unavailable.length > 0) out.push('', `[unavailable] ${d.unavailable.join(', ')}`);
  return out.join('\n');
}
