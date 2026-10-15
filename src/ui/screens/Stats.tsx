/** Stats (design.md §3.13): real numbers only, accessible chart with a table alternative. */
import { useState } from 'preact/hooks';
import type { WakeRecord } from '../../core/types';
import { Button } from '../components/Button';
import { Segmented } from '../components/controls';
import { Card, Screen } from '../components/layout';
import { useNow, useService, useUse24h } from '../context';
import { formatDayShort, formatDuration, formatInstantTime, formatTime, weekdayName } from '../format';
import { Icon } from '../icons';

interface DayRow {
  start: number;
  label: string;
  record: WakeRecord | null;
  minutes: number | null;
  snoozes: number;
}

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function buildDays(records: readonly WakeRecord[], now: number, days: number): DayRow[] {
  const out: DayRow[] = [];
  const today = startOfDay(now);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const start = d.getTime();
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const dayRecs = records.filter((r) => {
      const at = r.firstRangAt ?? r.scheduledFor ?? r.dismissedAt;
      return at != null && at >= start && at < end.getTime();
    });
    const dismissed = dayRecs.filter((r) => r.outcome === 'dismissed' && r.dismissedAt != null).sort((a, b) => (a.dismissedAt ?? 0) - (b.dismissedAt ?? 0));
    const rec = dismissed[0] ?? null;
    const from = rec ? (rec.firstRangAt ?? rec.scheduledFor) : null;
    const minutes = rec && from != null && rec.dismissedAt != null ? Math.max(0, Math.round((rec.dismissedAt - from) / 60_000)) : null;
    out.push({
      start,
      label: weekdayName(d.getDay() as 0, 'narrow'),
      record: rec,
      minutes,
      snoozes: dayRecs.reduce((n, r) => n + r.snoozeCount, 0),
    });
  }
  return out;
}

export function StatsScreen() {
  const service = useService();
  const use24h = useUse24h();
  const t = useNow(60_000);
  const [range, setRange] = useState<7 | 30>(7);
  const [table, setTable] = useState(false);
  const records = service.getWakeRecords();

  if (records.length === 0) {
    return (
      <Screen title="Stats" chrome="tabs" currentTab="stats">
        <div class="stack center" style="align-items: center; padding-top: var(--sp-6)">
          <Icon name="bar-chart" size={64} style="color: var(--text-muted)" />
          <h2>No mornings yet</h2>
          <p class="muted">Stats appear after your first alarm.</p>
        </div>
      </Screen>
    );
  }

  let streak = 0;
  try {
    streak = service.getStats().currentStreakDays;
  } catch {
    streak = 0;
  }
  const days = buildDays(records, t, range);
  const inRange = records.filter((r) => {
    const at = r.firstRangAt ?? r.scheduledFor ?? r.dismissedAt;
    return at != null && at >= (days[0]?.start ?? 0);
  });
  const dismissed = inRange.filter((r) => r.outcome === 'dismissed' && r.dismissedAt != null);
  const avgWake =
    dismissed.length > 0
      ? Math.round(
          dismissed.reduce((n, r) => {
            const d = new Date(r.dismissedAt!);
            return n + d.getHours() * 60 + d.getMinutes();
          }, 0) / dismissed.length,
        )
      : null;
  const snoozes = inRange.reduce((n, r) => n + r.snoozeCount, 0);
  const withMission = dismissed.filter((r) => r.missionTimeMs > 0);
  const avgMission = withMission.length ? withMission.reduce((n, r) => n + r.missionTimeMs, 0) / withMission.length : null;

  const values = days.map((d) => d.minutes).filter((m): m is number => m != null);
  const summary =
    values.length > 0
      ? `Over ${range} days, you took ${Math.min(...values)} to ${Math.max(...values)} minutes to get up, ${Math.round(values.reduce((a, b) => a + b, 0) / values.length)} on average.`
      : `No alarms turned off in the last ${range} days.`;

  const W = 320;
  const H = 160;
  const pad = 20;
  const max = Math.max(5, ...values);
  const bw = (W - pad * 2) / days.length;

  const stat = (id: string, title: string, value: string, helper?: string) => (
    <section class="card stat-card" aria-labelledby={`stat-${id}`}>
      <h2 id={`stat-${id}`}>{title}</h2>
      <p class="stat-value">{value}</p>
      {helper && <p class="muted small">{helper}</p>}
    </section>
  );

  return (
    <Screen title="Stats" chrome="tabs" currentTab="stats">
      <Segmented
        label="Range"
        fill
        options={[
          { value: 7, label: '7 days' },
          { value: 30, label: '30 days' },
        ]}
        value={range}
        onChange={(v) => setRange(v as 7 | 30)}
      />
      <div class="stat-grid">
        {stat('streak', 'Streak', `${streak} ${streak === 1 ? 'day' : 'days'}`, 'Mornings in a row you got up with your alarm.')}
        {stat('wake', 'Average wake time', avgWake != null ? formatTime(Math.floor(avgWake / 60), avgWake % 60, use24h) : '–')}
        {stat('snoozes', 'Snoozes', String(snoozes), `in the last ${range} days`)}
        {stat('mission', 'Mission time', avgMission != null ? formatDuration(avgMission) : '–')}
      </div>
      <Card class="chart stack-sm">
        <h2>Time to get up</h2>
        <p class="muted small">Minutes from first ring to alarm off</p>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
          {days.map((d, i) => {
            const x = pad + i * bw + bw * 0.15;
            const w = bw * 0.7;
            const label = range === 7 || i % 5 === 0 ? d.label : '';
            if (d.minutes == null) {
              return (
                <g key={d.start}>
                  <text x={x + w / 2} y={H - pad - 4} text-anchor="middle">
                    –
                  </text>
                  <text x={x + w / 2} y={H - 4} text-anchor="middle">
                    {label}
                  </text>
                </g>
              );
            }
            const h = Math.max(2, ((H - pad * 2 - 12) * d.minutes) / max);
            const y = H - pad - h;
            return (
              <g key={d.start}>
                <rect class="bar" x={x} y={y} width={w} height={h} rx="2" />
                {d.minutes >= 1 && range === 7 && (
                  <text class="bar-value" x={x + w / 2} y={y - 3} text-anchor="middle">
                    {d.minutes}
                  </text>
                )}
                <text x={x + w / 2} y={H - 4} text-anchor="middle">
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
        <Button variant="text" aria-expanded={table ? 'true' : 'false'} onClick={() => setTable(!table)}>
          {table ? 'Hide table' : 'Show as table'}
        </Button>
        {table && (
          <table class="data">
            <caption class="visually-hidden">{summary}</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Alarm</th>
                <th scope="col">Off at</th>
                <th scope="col">Minutes</th>
                <th scope="col">Snoozes</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.start}>
                  <td>{formatDayShort(d.start)}</td>
                  <td>{d.record ? d.record.label || 'Alarm' : '–'}</td>
                  <td>{d.record?.dismissedAt ? formatInstantTime(d.record.dismissedAt, use24h) : '–'}</td>
                  <td>{d.minutes ?? '–'}</td>
                  <td>{d.snoozes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Screen>
  );
}
