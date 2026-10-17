/** Onboarding (design.md §3.1, flow §8.1). */
import { useState } from 'preact/hooks';
import type { HealthCheckId } from '../../platform/AlarmBackend';
import type { Weekday } from '../../core/types';
import { nextOccurrence } from '../../core/schedule';
import { Button } from '../components/Button';
import { DayChips, TimePicker } from '../components/controls';
import { CheckRow, Screen } from '../components/layout';
import { toast } from '../components/feedback';
import { emitHealthChanged, useApp, useService, useUse24h } from '../context';
import { formatIn, formatTime, missionName, missionSummary } from '../format';
import { checkStatus, findCheck, useHealth } from '../health';
import { Icon } from '../icons';
import { navigate } from '../router';
import { startDraft } from '../draft';
import { WebDemoBanner } from './shared';

const PERMISSION_ROWS: { id: HealthCheckId; title: string; okText: string; problem: string }[] = [
  { id: 'notifications', title: 'Notifications', okText: 'Allowed', problem: "Off: Rouse can't show the alarm screen." },
  { id: 'exactAlarm', title: 'Alarms & reminders', okText: 'Allowed', problem: 'Off: alarms may ring late or not at all.' },
  { id: 'fullScreenIntent', title: 'Full-screen alerts', okText: 'Allowed', problem: 'Off: the alarm shows as a small banner instead of full screen.' },
  { id: 'displayOverApps', title: 'Open over other apps', okText: 'Allowed', problem: 'Off: while you use the phone, the alarm shows as a banner instead of full screen.' },
  { id: 'batteryOptimization', title: 'Battery: unrestricted', okText: 'Unrestricted', problem: 'Optimised: Android may stop Rouse overnight.' },
];

function Steps({ n }: { n: number }) {
  return (
    <div class="stack-sm">
      <p class="muted">Step {n} of 3</p>
      <div class="dots" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} class={i === n ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}

export function Onboarding({ step }: { step: 1 | 2 | 3 }) {
  const titles = { 1: 'Welcome', 2: 'Make sure it rings', 3: 'Your first alarm' } as const;
  return (
    <Screen title={titles[step]} chrome="none" customHeading>
      <div class="onboarding">
        <Steps n={step} />
        <WebDemoBanner />
        {step === 1 && <StepWelcome />}
        {step === 2 && <StepPermissions />}
        {step === 3 && <StepFirstAlarm />}
      </div>
    </Screen>
  );
}

function StepWelcome() {
  return (
    <>
      <Icon name="sun" size={64} style="color: var(--accent)" />
      <h1 tabIndex={-1}>Rouse gets you out of bed.</h1>
      <p>Choose a mission (math, a QR code in another room, steps…) and the alarm keeps ringing until you've done it.</p>
      <ul class="check-lines">
        <li>
          <Icon name="check" />
          Every feature is free
        </li>
        <li>
          <Icon name="check" />
          No ads, no account
        </li>
        <li>
          <Icon name="check" />
          No internet: nothing leaves your phone
        </li>
      </ul>
      <div class="ring-spacer" />
      <Button variant="primary" block onClick={() => navigate('/onboarding/2')}>
        Get started
      </Button>
    </>
  );
}

function StepPermissions() {
  const { backend } = useApp();
  const { health, refreshing, refresh } = useHealth();
  const web = backend.kind === 'web';
  const anyNotOk = !web && PERMISSION_ROWS.some((r) => findCheck(health, r.id)?.state !== 'ok');
  return (
    <>
      <h1 tabIndex={-1}>Make sure it rings</h1>
      <p>Android can block alarms. Allow these so Rouse works when your phone is locked.</p>
      <ul class="list">
        {PERMISSION_ROWS.map((r) => {
          const c = findCheck(health, r.id);
          if (web) {
            return <CheckRow key={r.id} status="unsupported" title={r.title} statusText="Not in web demo" detail="Not available in the web demo" />;
          }
          const st = checkStatus(c, false);
          const ok = st === 'ok';
          return (
            <CheckRow
              key={r.id}
              status={st}
              title={r.title}
              pending={refreshing && !health}
              statusText={ok ? r.okText : undefined}
              detail={ok ? r.okText : r.problem}
              fix={
                !ok && c?.fix !== 'none'
                  ? {
                      label: 'Allow',
                      onClick: async () => {
                        await backend.requestFix(r.id);
                        await refresh();
                        emitHealthChanged();
                      },
                    }
                  : null
              }
            />
          );
        })}
      </ul>
      <div class="ring-spacer" />
      {anyNotOk && <p class="muted">Rouse might not ring reliably until these are allowed. You can fix them later in Reliability.</p>}
      <Button variant="primary" block onClick={() => navigate('/onboarding/3')}>
        Continue
      </Button>
    </>
  );
}

function StepFirstAlarm() {
  const { now } = useApp();
  const service = useService();
  const use24h = useUse24h();
  const settings = service.getSettings();
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [days, setDays] = useState<Weekday[]>([1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false);
  const firstMission = settings.alarmDefaults.missions[0];
  const missionLine = settings.alarmDefaults.randomMission
    ? 'Random mission'
    : firstMission
      ? `${missionName(firstMission.type)} · ${missionSummary(firstMission)}`
      : 'No mission';

  const buildDraft = () => {
    const a = service.newAlarmDraft();
    return { ...a, hour, minute, days };
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    const res = await service.saveAlarm(buildDraft());
    await service.updateSettings({ onboardingDone: true });
    navigate('/alarms', { replace: true });
    if (res.ok) {
      const at = nextOccurrence(res.alarm, now());
      toast(`Alarm set for ${formatTime(hour, minute, use24h)}${at ? `, ${formatIn(at - now())}` : ''}`);
    }
  };

  return (
    <>
      <h1 tabIndex={-1}>Your first alarm</h1>
      <TimePicker
        hour={hour}
        minute={minute}
        use24h={use24h}
        onChange={(h, m) => {
          setHour(h);
          setMinute(m);
        }}
      />
      <DayChips value={days} weekStart={settings.weekStartsOn} onChange={setDays} />
      <div class="row-between">
        <p>Mission: {missionLine}</p>
        <Button
          variant="text"
          onClick={async () => {
            const draft = buildDraft();
            startDraft('new', draft);
            await service.updateSettings({ onboardingDone: true });
            navigate('/alarm/new');
          }}
        >
          Change
        </Button>
      </div>
      <div class="ring-spacer" />
      <div class="stack-sm">
        <Button variant="primary" block onClick={create} ariaDisabled={busy}>
          Create alarm
        </Button>
        <Button
          variant="text"
          block
          onClick={async () => {
            await service.updateSettings({ onboardingDone: true });
            navigate('/alarms', { replace: true });
          }}
        >
          I'll do it later
        </Button>
      </div>
    </>
  );
}
