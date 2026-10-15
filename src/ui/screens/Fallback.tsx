/** Backup mission offer (design.md §3.8). */
import { useEffect } from 'preact/hooks';
import { isFallbackOffered } from '../../core/ringController';
import { Button } from '../components/Button';
import { Screen } from '../components/layout';
import { useApp, useRingManager, useService } from '../context';
import { fallbackDescription } from '../format';
import { navigate } from '../router';

export function FallbackScreen() {
  const { now } = useApp();
  const mgr = useRingManager();
  const service = useService();
  const ctrl = mgr.getController();
  const session = mgr.getSession();
  const settings = service.getSettings();
  useEffect(() => {
    if (!ctrl || !session || session.phase !== 'solving') navigate('/ring', { replace: true });
  }, [ctrl, session?.phase]);
  if (!ctrl || !session || session.phase !== 'solving') return null;
  const backToMission = () => navigate(`/ring/mission/${session.missionIndex}${session.purpose === 'snooze' ? '?snooze=1' : ''}`, { replace: true });
  const offered = isFallbackOffered(session, settings, now());

  if (!offered) {
    const minutes = session.missionStartedAt != null ? Math.floor((now() - session.missionStartedAt) / 60_000) : 0;
    return (
      <Screen title="Backup mission" chrome="locked">
        <p>
          The backup mission unlocks after {settings.fallback.afterFailures} tries or {settings.fallback.afterMinutes} minutes. So far: {session.failedAttempts}{' '}
          {session.failedAttempts === 1 ? 'try' : 'tries'}, {minutes} min.
        </p>
        <Button variant="primary" size="ring" block onClick={backToMission}>
          Keep trying
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title="Switch to the backup mission?" chrome="locked">
      <p>
        This mission isn't working right now. The backup is longer on purpose: {fallbackDescription(settings.fallback.mission)}. It still turns the alarm off.
      </p>
      <div class="ring-spacer" />
      <div class="ring-actions">
        <Button
          variant="primary"
          size="ring-primary"
          block
          data-initial-focus=""
          onClick={() => {
            ctrl.acceptFallback();
            backToMission();
          }}
        >
          Start backup mission
        </Button>
        <Button variant="secondary" size="ring" block onClick={backToMission}>
          Keep trying
        </Button>
      </div>
    </Screen>
  );
}
