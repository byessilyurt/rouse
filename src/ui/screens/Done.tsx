/** Good morning (design.md §3.10). */
import { Button } from '../components/Button';
import { Banner, Screen } from '../components/layout';
import { useApp, useNow, useRingManager, useService, useUse24h } from '../context';
import { formatDayTime, formatDuration, formatIn, formatInstantTime } from '../format';
import { Icon } from '../icons';
import { navigate } from '../router';

export function DoneScreen() {
  const { now } = useApp();
  const mgr = useRingManager();
  const service = useService();
  const use24h = useUse24h();
  const t = useNow(30_000);
  const info = mgr.lastFinished;
  const ring = mgr.getRing();
  const isTest = info?.isTest ?? false;
  let streak = 0;
  try {
    streak = service.getStats().currentStreakDays;
  } catch {
    streak = 0;
  }
  const next = service.nextFire();
  const wakeCheckAt = ring?.state === 'wake-check-wait' ? ring.wakeCheckAt : null;
  const back = isTest && mgr.testReturnTo ? mgr.testReturnTo : '/alarms';

  return (
    <Screen title="Good morning" chrome="none" customHeading>
      <Icon name="sun" size={64} style="color: var(--accent)" />
      <h1 tabIndex={-1}>Good morning</h1>
      {isTest ? (
        <p>Test finished. Nothing was recorded.</p>
      ) : (
        info && (
          <div class="stack-sm">
            <p style="font-size: var(--fs-lg)">You're up at {formatInstantTime(info.at, use24h)}.</p>
            {info.session.missionTimeMs > 0 && <p class="muted">Mission took {formatDuration(info.session.missionTimeMs)}.</p>}
          </div>
        )
      )}
      {!isTest && streak >= 2 && (
        <p class="row">
          <Icon name="flame" style="color: var(--accent)" />
          {streak}-day streak
        </p>
      )}
      {wakeCheckAt != null && (
        <Banner tone="info">Wake-up check in {Math.max(1, Math.round((wakeCheckAt - now()) / 60_000))} min. Keep your phone nearby.</Banner>
      )}
      <p>{next ? `Next alarm: ${formatDayTime(next.fireAt, t, use24h)} · ${formatIn(next.fireAt - t)}` : 'No other alarms on.'}</p>
      <div class="ring-spacer" />
      <Button
        variant="primary"
        block
        onClick={() => {
          if (isTest) mgr.testReturnTo = null;
          navigate(back, { replace: true });
        }}
      >
        Done
      </Button>
    </Screen>
  );
}
