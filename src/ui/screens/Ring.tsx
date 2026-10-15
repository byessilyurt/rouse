/** Ringing screen (design.md §3.6). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { snoozesLeft } from '../../core/ringController';
import { Button } from '../components/Button';
import { Banner, Screen, Spinner } from '../components/layout';
import { announce } from '../components/feedback';
import { useApp, useNow, useRingManager, useUse24h } from '../context';
import { formatFullDate, missionProseName, timeParts } from '../format';
import { navigate } from '../router';

export function RingScreen() {
  const { now } = useApp();
  const mgr = useRingManager();
  const use24h = useUse24h();
  const t = useNow(1000);
  const ring = mgr.getRing();
  const ctrl = mgr.getController();
  const session = mgr.getSession();
  const readyFor = useRef<unknown>(null);
  const [snoozeBusy, setSnoozeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ringing = ring?.state === 'ringing' && !!ctrl && !!session;

  // Tell the backend the mission UI is up (cancels the native fallback timer) and announce once.
  useEffect(() => {
    if (!ringing || !ctrl || readyFor.current === ctrl) return;
    readyFor.current = ctrl;
    void ctrl.uiReady().catch(() => undefined);
    const d = new Date(now());
    const tp = timeParts(d.getHours(), d.getMinutes(), use24h);
    announce(`Alarm, ${tp.time}${tp.suffix ? ` ${tp.suffix}` : ''}${ring?.alarm.label ? `, ${ring.alarm.label}` : ''}.`, 'assertive');
  }, [ringing, ctrl]);

  // Already solving (e.g. came back via history) → mission screen.
  useEffect(() => {
    if (session?.phase === 'solving') navigate(`/ring/mission/${session.missionIndex}${session.purpose === 'snooze' ? '?snooze=1' : ''}`, { replace: true });
  }, [session?.phase]);

  if (!ringing || !ring || !ctrl || !session) {
    const waitingForTest = mgr.testPendingSince != null && now() - mgr.testPendingSince < 15_000;
    return (
      <Screen title={waitingForTest ? 'Test alarm' : 'Alarm'} chrome="locked">
        {waitingForTest ? (
          <Spinner label="Starting test…" />
        ) : (
          <>
            <p>No alarm is ringing.</p>
            <Button variant="primary" block onClick={() => navigate('/alarms', { replace: true })}>
              Go to alarms
            </Button>
          </>
        )}
      </Screen>
    );
  }

  const alarm = ring.alarm;
  const left = snoozesLeft(session);
  const snoozeShown = alarm.snooze.enabled && ring.source !== 'wake-check';
  const noSnoozes = left <= 0;
  const plan = session.plan;
  const missionLabel = alarm.randomMission ? 'Random mission' : plan.map((m) => missionProseName(m.type)).join(', then ');
  const d = new Date(t);
  const tp = timeParts(d.getHours(), d.getMinutes(), use24h);

  const start = () => {
    ctrl.startMission();
    const s = ctrl.getSession();
    if (s.phase === 'solving') navigate(`/ring/mission/${s.missionIndex}`);
  };

  const snooze = async () => {
    if (noSnoozes) {
      announce('Finish the mission to turn the alarm off.', 'polite');
      return;
    }
    if (snoozeBusy) return;
    setSnoozeBusy(true);
    setError(null);
    try {
      await ctrl.requestSnooze();
      const s = ctrl.getSession();
      if (s.phase === 'solving' && s.purpose === 'snooze') navigate(`/ring/mission/${s.missionIndex}?snooze=1`);
    } catch {
      setError("Couldn't snooze. Start the mission to turn the alarm off.");
    } finally {
      setSnoozeBusy(false);
    }
  };

  return (
    <Screen title="Alarm" chrome="locked" customHeading class="ring-shell">
      <div class="ring-screen">
        {ring.isTest && (
          <Banner
            tone="info"
            action={
              <Button
                variant="text"
                onClick={async () => {
                  const back = mgr.testReturnTo ?? '/alarms';
                  mgr.testReturnTo = null;
                  await mgr.endTest();
                  navigate(back, { replace: true });
                }}
              >
                End test
              </Button>
            }
          >
            Test alarm · won't count in stats
          </Banner>
        )}
        {(ring.source === 'safety' || ring.source === 'catch-up') && !ring.isTest && <Banner tone="warn">The alarm was interrupted, so it's ringing again.</Banner>}
        {ring.source === 'wake-check' && <Banner tone="warn">You didn't answer the wake-up check, so the alarm is back.</Banner>}
        <p class="ring-date">{formatFullDate(t)}</p>
        <h1 class="ring-clock" tabIndex={-1} data-clock>
          <time>{tp.time}</time>
          {tp.suffix && <span style="font-size: var(--fs-xl)"> {tp.suffix}</span>}
        </h1>
        {alarm.label && <p class="ring-label">{alarm.label}</p>}
        {session.snoozeCount > 0 && (
          <p class="muted">
            Snoozed {session.snoozeCount} of {alarm.snooze.maxCount}
          </p>
        )}
        <div class="ring-spacer" />
        {error && (
          <Banner tone="error" alert>
            {error}
          </Banner>
        )}
        <div class="ring-actions">
          <Button variant="primary" size="ring-primary" block data-initial-focus="" subLabel={plan.length > 0 ? missionLabel : undefined} onClick={start}>
            {plan.length > 0 ? 'Start mission' : 'Turn off'}
          </Button>
          {snoozeShown && (
            <>
              {noSnoozes && <p class="center">Finish the mission to turn the alarm off.</p>}
              <Button
                variant="secondary"
                size="ring"
                block
                icon="snooze"
                ariaDisabled={noSnoozes || snoozeBusy}
                subLabel={!noSnoozes && alarm.snooze.requireMission ? 'Finish the mission to snooze' : undefined}
                onClick={snooze}
              >
                {noSnoozes ? 'No snoozes left' : `Snooze ${alarm.snooze.intervalMin} min · ${left} left`}
              </Button>
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}
