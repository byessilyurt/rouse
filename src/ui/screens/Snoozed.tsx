/** Snoozed (design.md §3.9). A courtesy view; native owns the snooze timer. */
import { useEffect } from 'preact/hooks';
import { Button } from '../components/Button';
import { Screen } from '../components/layout';
import { announce } from '../components/feedback';
import { useNow, useRingManager, useUse24h } from '../context';
import { formatClockCountdown, formatInstantTime } from '../format';
import { navigate } from '../router';
import { WAKE, useWake } from '../wake';

export function SnoozedScreen() {
  const mgr = useRingManager();
  const use24h = useUse24h();
  const t = useNow(1000);
  const ring = mgr.getRing();
  const snoozed = ring?.state === 'snoozed' && ring.snoozeUntil != null ? ring : null;
  useWake(WAKE.snoozed);

  useEffect(() => {
    if (snoozed?.snoozeUntil) announce(`Snoozed. Rings again at ${formatInstantTime(snoozed.snoozeUntil, use24h)}.`, 'polite');
  }, [snoozed?.sessionId]);

  if (!snoozed || snoozed.snoozeUntil == null) {
    return (
      <Screen title="Snoozed" chrome="none">
        <p>Nothing is snoozed right now.</p>
        <Button variant="primary" block onClick={() => navigate('/alarms', { replace: true })}>
          Go to alarms
        </Button>
      </Screen>
    );
  }
  const left = Math.max(0, snoozed.alarm.snooze.maxCount - snoozed.snoozeCount);
  return (
    <Screen title="Snoozed" chrome="none">
      <p style="font-size: var(--fs-2xl); font-weight: var(--fw-bold)" data-testid="snoozed-until">
        Rings again at {formatInstantTime(snoozed.snoozeUntil, use24h)}
      </p>
      <p class="tabular" aria-live="off">
        {formatClockCountdown(snoozed.snoozeUntil - t)} to go
      </p>
      <p class="muted">Snoozes left: {left}</p>
      <div class="ring-spacer" />
      <Button
        variant="primary"
        size="ring"
        block
        onClick={() => {
          const ctrl = mgr.startEarly();
          const s = ctrl?.getSession();
          if (!s) return;
          if (s.phase === 'solving') navigate(`/ring/mission/${s.missionIndex}`);
        }}
      >
        I'm up: turn it off
      </Button>
      <Button variant="text" block onClick={() => navigate('/alarms')}>
        Go to alarms
      </Button>
    </Screen>
  );
}
