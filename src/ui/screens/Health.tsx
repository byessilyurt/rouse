/** Reliability (design.md §3.12). */
import { useEffect, useState } from 'preact/hooks';
import type { HealthCheckId } from '../../platform/AlarmBackend';
import { createAlarm } from '../../core/defaults';
import { Button } from '../components/Button';
import { Banner, Card, CheckRow, Screen, type CheckStatus } from '../components/layout';
import { emitHealthChanged, useApp, useNow, useService } from '../context';
import { formatClockCountdown, formatDayMonth } from '../format';
import { checkStatus, findCheck, useHealth } from '../health';
import { Icon } from '../icons';
import { goBack } from '../router';
import { readUiPrefs, writeUiPrefs } from '../uiPrefs';

interface RowSpec {
  id: HealthCheckId;
  title: string;
  ok: string;
  problem: string;
  fix: string;
}

const ROWS: RowSpec[] = [
  { id: 'notifications', title: 'Notifications', ok: 'Allowed', problem: "Off: Rouse can't show the alarm screen.", fix: 'Allow' },
  { id: 'exactAlarm', title: 'Alarms & reminders', ok: 'Allowed', problem: 'Off: alarms may ring late or not at all.', fix: 'Allow' },
  { id: 'fullScreenIntent', title: 'Full-screen alerts', ok: 'Allowed', problem: 'Off: the alarm shows as a small banner instead of full screen.', fix: 'Allow' },
  { id: 'batteryOptimization', title: 'Battery', ok: 'Unrestricted', problem: 'Optimised: Android may stop Rouse overnight.', fix: 'Fix' },
  { id: 'backgroundRestricted', title: 'Background use', ok: 'Allowed', problem: 'Restricted: Android may stop Rouse in the background.', fix: 'Open settings' },
  { id: 'dndAllowsAlarms', title: 'Do Not Disturb', ok: 'Alarms allowed', problem: 'Do Not Disturb is blocking alarms.', fix: 'Open settings' },
  {
    id: 'alarmVolume',
    title: 'Alarm volume',
    ok: 'OK',
    problem: "Alarm volume is low. Rouse raises it while ringing, but check it's not muted.",
    fix: 'Open sound settings',
  },
];

export function HealthScreen() {
  const { backend, now } = useApp();
  const service = useService();
  const { health, refreshing, refresh } = useHealth();
  const t = useNow(1000);
  const [prefs, setPrefs] = useState(readUiPrefs);
  const web = backend.kind === 'web';
  let mismatches = 0;
  try {
    mismatches = service.getSchedulerMismatches().length;
  } catch {
    mismatches = 0;
  }

  // A scheduled health test that should have rung by now but never did.
  useEffect(() => {
    if (prefs.pendingTestAt != null && t - prefs.pendingTestAt > 3 * 60_000) {
      setPrefs(writeUiPrefs({ pendingTestAt: null, lastTestMissedAt: prefs.pendingTestAt }));
    }
  }, [t]);

  const statuses = ROWS.map((r) => ({ r, c: findCheck(health, r.id), st: checkStatus(findCheck(health, r.id), web) }));
  const errors = statuses.filter((s) => s.st === 'error').length;
  const warns = statuses.filter((s) => s.st === 'warn').length + (mismatches > 0 ? 1 : 0);

  const fix = async (id: HealthCheckId) => {
    await backend.requestFix(id).catch(() => 'unsupported');
    await refresh();
    emitHealthChanged();
  };

  const testPending = prefs.pendingTestAt != null && prefs.pendingTestAt > t;
  const startTest = async () => {
    const s = service.getSettings();
    const alarm = createAlarm({
      id: `test-${crypto.randomUUID()}`,
      now: now(),
      defaults: {
        ...s.alarmDefaults,
        missions: [{ type: 'math', difficulty: 1, count: 1 }],
        randomMission: false,
        wakeUpCheck: { ...s.alarmDefaults.wakeUpCheck, enabled: false },
      },
    });
    const { fireAt } = await backend.testAlarm({ ...alarm, label: 'Test alarm' }, 60);
    setPrefs(writeUiPrefs({ pendingTestAt: fireAt }));
  };

  const lastOk = prefs.lastTestOkAt;
  const lastMissed = prefs.lastTestMissedAt != null && (lastOk == null || prefs.lastTestMissedAt > lastOk);
  const testStatus: CheckStatus = lastMissed ? 'error' : lastOk ? 'ok' : 'warn';

  return (
    <Screen title="Reliability" chrome="top" onBack={() => goBack('/alarms')}>
      <Card class="stack-sm" data-testid="health-summary">
        {web ? (
          <p class="row">
            <Icon name="info" style="color: var(--info)" />
            <strong>Web demo: alarms only ring while this tab is open and the screen is on.</strong>
          </p>
        ) : errors > 0 ? (
          <p class="row">
            <Icon name="x-octagon" style="color: var(--danger)" />
            <strong>Your alarms may not ring</strong>
          </p>
        ) : warns > 0 ? (
          <p class="row">
            <Icon name="alert-triangle" style="color: var(--warn)" />
            <strong>
              {warns} {warns === 1 ? 'thing' : 'things'} could stop your alarm
            </strong>
          </p>
        ) : (
          <>
            <p class="row">
              <Icon name="check-circle" style="color: var(--ok)" />
              <strong>Rouse can ring</strong>
            </p>
            <p class="muted">{lastOk ? `Last test: rang OK on ${formatDayMonth(lastOk)}.` : 'Run a test to be sure.'}</p>
          </>
        )}
      </Card>
      {web && (
        <Banner tone="warn" testId="web-health-banner">
          This web demo can't wake a locked phone or ring when the tab is closed. Use the Android app for real alarms.
        </Banner>
      )}
      <ul class="list" aria-label="Checks">
        {statuses.map(({ r, c, st }) => (
          <CheckRow
            key={r.id}
            status={st}
            title={r.title}
            pending={refreshing && !health}
            statusText={st === 'ok' ? 'OK' : undefined}
            detail={web && c?.state === 'unsupported' ? 'Not in the web demo.' : st === 'ok' ? r.ok : c?.state === 'unknown' ? (c.detail || 'Unknown') : r.problem}
            fix={st !== 'ok' && c && c.fix !== 'none' ? { label: r.fix, onClick: () => void fix(r.id) } : null}
          />
        ))}
        <CheckRow
          status={web ? 'unsupported' : health?.manufacturer && ['xiaomi', 'huawei', 'samsung', 'oneplus', 'oppo', 'vivo', 'realme', 'meizu', 'asus', 'honor'].includes(health.manufacturer) ? 'warn' : 'ok'}
          title="Phone maker"
          detail={
            web
              ? 'Not in the web demo.'
              : health?.manufacturer
                ? `${capitalise(health.manufacturer)} phones often stop apps in the background.`
                : 'No known issues.'
          }
          fix={
            !web && health?.manufacturer
              ? { label: 'Read the steps', onClick: () => window.open(`https://dontkillmyapp.com/${encodeURIComponent(health.manufacturer!)}`, '_blank', 'noopener') }
              : null
          }
        />
        {mismatches > 0 && (
          <CheckRow
            status="error"
            title="Schedule check"
            detail={`Android and Rouse disagree about when ${mismatches} ${mismatches === 1 ? 'alarm rings' : 'alarms ring'}. Open and save ${mismatches === 1 ? 'it' : 'them'} again.`}
          />
        )}
        <CheckRow
          status={testStatus}
          title="Test alarm"
          statusText={testStatus === 'ok' ? 'OK' : testStatus === 'error' ? 'Blocked' : 'Needs attention'}
          detail={lastMissed ? "Last test didn't ring" : lastOk ? `Rang OK on ${formatDayMonth(lastOk)}` : 'Never tested'}
        />
      </ul>
      <div class="stack-sm">
        <Button variant="primary" block icon="play" ariaDisabled={testPending} onClick={() => !testPending && void startTest()}>
          {testPending ? `Test rings in ${formatClockCountdown((prefs.pendingTestAt ?? t) - t)}` : 'Test alarm in 1 minute'}
        </Button>
        <p class="muted">Lock your phone now. If it doesn't ring, the checks above should show why.</p>
        <p class="muted small">If you Force stop Rouse in Android settings, Android cancels its alarms until you open Rouse again.</p>
      </div>
    </Screen>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
