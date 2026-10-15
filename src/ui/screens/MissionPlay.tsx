/** Mission play frame (design.md §3.7) for the ring chain, and the practice route ("Try it now"). */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MissionConfig } from '../../core/types';
import { MISSION_UNAVAILABLE, currentMission, isFallbackOffered } from '../../core/ringController';
import { randomRng } from '../../missions/rng';
import { Button } from '../components/Button';
import { IdleMeter, Screen, StatusPill } from '../components/layout';
import { Sheet } from '../components/overlays';
import { announce } from '../components/feedback';
import { useApp, useNow, useRingManager, useService } from '../context';
import { missionName } from '../format';
import { Icon } from '../icons';
import { goBack, navigate } from '../router';
import { getDraft } from '../draft';
import { MissionView } from '../missions/MissionView';
import { prefersReducedMotion } from '../missions/common';

function SuccessOverlay() {
  return (
    <div class="success-overlay" role="status">
      <Icon name="check-circle" size={96} />
      <span>Done</span>
    </div>
  );
}

function Strip({ left, right }: { left: ComponentChildren; right: ComponentChildren }) {
  return (
    <div class="mission-strip">
      <h1 tabIndex={-1} style="font-size: var(--fs-lg)">
        {left}
      </h1>
      <span class="muted" aria-live="off" data-testid="mission-progress">
        {right}
      </span>
    </div>
  );
}

export function MissionPlayScreen({ step }: { step: number }) {
  const { now } = useApp();
  const mgr = useRingManager();
  const service = useService();
  const t = useNow(250);
  const ctrl = mgr.getController();
  const session = mgr.getSession();
  const settings = service.getSettings();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [interstitial, setInterstitial] = useState<string | null>(null);
  const [lockedSheet, setLockedSheet] = useState(false);
  const announced = useRef<string>('');
  const rng = useMemo(() => randomRng(), [session?.sessionId, session?.missionIndex, session?.fallbackActive]);

  const phase = session?.phase;
  useEffect(() => {
    if (!ctrl || !session) {
      navigate('/ring', { replace: true });
      return;
    }
    if (phase === 'alerting') navigate('/ring', { replace: true });
    else if (phase === 'solving' && step !== session.missionIndex) {
      navigate(`/ring/mission/${session.missionIndex}${session.purpose === 'snooze' ? '?snooze=1' : ''}`, { replace: true });
    }
  }, [ctrl, phase, session?.missionIndex]);

  // 1 s "Next: {Name}" interstitial between chained missions.
  const lastIndex = useRef(session?.missionIndex ?? 0);
  useEffect(() => {
    if (!session) return;
    if (session.missionIndex !== lastIndex.current && session.phase === 'solving') {
      const m = currentMission(session, settings);
      if (m) {
        setInterstitial(`Next: ${missionName(m.type)}`);
        announce(`Next: ${missionName(m.type)}`, 'polite');
        const tm = setTimeout(() => setInterstitial(null), 1000);
        lastIndex.current = session.missionIndex;
        return () => clearTimeout(tm);
      }
    }
    lastIndex.current = session.missionIndex;
    return undefined;
  }, [session?.missionIndex]);

  if (!ctrl || !session) return null;
  if (overlay || phase === 'completing' || phase === 'dismissed') return <Screen title="Done" chrome="locked">{<SuccessOverlay />}</Screen>;
  if (phase !== 'solving') return null;
  const mission = currentMission(session, settings);
  if (!mission) return null;

  const isSnooze = session.purpose === 'snooze';
  const total = isSnooze ? 1 : session.plan.length;
  const name = session.fallbackActive ? `Backup: ${missionName(mission.type)}` : missionName(mission.type);
  const missionKey = `${session.sessionId}|${session.missionIndex}`;
  const unavailable = mgr.unavailableKey === missionKey && !session.fallbackActive;

  // Idle meter: time left on the silence lease.
  const leaseMs = settings.silenceWhileSolvingSec * 1000;
  const since = session.lastActivityAt ?? session.missionStartedAt ?? t;
  const remaining = session.silenced ? Math.max(0, leaseMs - (t - since)) : 0;
  const meterState = !session.silenced ? 'ringing' : remaining <= 10_000 ? 'warning' : 'quiet';
  const secs = Math.ceil(remaining / 1000);
  const announceKey = `${since}|${secs <= 5 ? 5 : secs <= 10 ? 10 : 0}|${meterState}`;
  if (session.silenced && (secs === 10 || secs === 5) && announced.current !== announceKey) {
    announced.current = announceKey;
    setTimeout(() => announce(`Alarm returns in ${secs} seconds`, 'polite'), 0);
  }

  const elapsed = session.missionStartedAt != null ? now() - session.missionStartedAt : 0;
  const showFooter = !session.fallbackActive && (session.failedAttempts >= 1 || elapsed >= 60_000 || unavailable);

  const openFallback = () => {
    if (unavailable || isFallbackOffered(session, settings, now())) navigate('/ring/fallback');
    else setLockedSheet(true);
  };

  const onSuccess = () => {
    const last = isSnooze || session.missionIndex >= session.plan.length - 1;
    try {
      navigator.vibrate?.([30, 60, 30]);
    } catch {
      /* ignore */
    }
    if (last) {
      setOverlay(true);
      setTimeout(() => {
        void ctrl.missionSucceeded().catch(() => setOverlay(false));
      }, prefersReducedMotion() ? 0 : 600);
    } else {
      void ctrl.missionSucceeded();
    }
  };

  const onUnavailable = (reason: string) => {
    if (session.fallbackActive) return;
    mgr.unavailableKey = missionKey;
    // Core unlocks the backup mission at once for MISSION_UNAVAILABLE.
    ctrl.missionFailed(MISSION_UNAVAILABLE);
    void reason;
  };

  const minutesSoFar = Math.floor(elapsed / 60_000);

  return (
    <Screen title={`Mission ${Math.min(session.missionIndex + 1, total)} of ${total}`} chrome="locked" customHeading>
      <div
        class="stack"
        onPointerDown={() => ctrl.activity()}
        onKeyDown={() => ctrl.activity()}
        data-testid="mission-play"
        data-mission-type={mission.type}
      >
        <Strip
          left={
            <>
              {isSnooze ? 'Snooze' : `Mission ${session.missionIndex + 1} of ${total}`} · {name}
            </>
          }
          right={progress ? `${progress.done} of ${progress.total}` : ''}
        />
        <Button
          variant="text"
          onClick={() => {
            ctrl.cancelSnoozeMission();
            navigate('/ring', { replace: true });
          }}
          style="align-self: flex-start"
        >
          Back to alarm
        </Button>
        <IdleMeter remainingMs={remaining} totalMs={leaseMs} state={meterState} />
        {interstitial ? (
          <p class="center" style="font-size: var(--fs-2xl); padding: var(--sp-7) 0" role="status">
            {interstitial}
          </p>
        ) : (
          <MissionView
            key={`${missionKey}|${session.fallbackActive}|${session.purpose}`}
            config={mission}
            rng={rng}
            practice={false}
            onSuccess={onSuccess}
            onFailure={(reason) => ctrl.missionFailed(reason)}
            onActivity={() => ctrl.activity()}
            onProgress={(done, tot) => setProgress((p) => (p && p.done === done && p.total === tot ? p : { done, total: tot }))}
            onUnavailable={onUnavailable}
            onUseBackup={() => {
              onUnavailable('camera');
              navigate('/ring/fallback');
            }}
          />
        )}
        {showFooter && (
          <Button variant="text" block onClick={openFallback}>
            Can't do this mission?
          </Button>
        )}
      </div>
      <Sheet open={lockedSheet} title="Backup mission" onClose={() => setLockedSheet(false)} dismissible={false}>
        <p>
          The backup mission unlocks after {settings.fallback.afterFailures} tries or {settings.fallback.afterMinutes} minutes. So far: {session.failedAttempts}{' '}
          {session.failedAttempts === 1 ? 'try' : 'tries'}, {minutesSoFar} min.
        </p>
        <Button variant="primary" block onClick={() => setLockedSheet(false)}>
          Keep trying
        </Button>
      </Sheet>
    </Screen>
  );
}

/** "Try it now" from mission config: no sound, no meter, "Practice" pill, then back. */
export function PracticeScreen({ id, index }: { id: string; index: number }) {
  const draft = getDraft();
  const config: MissionConfig | null =
    draft && draft.key === id ? ((draft.editing?.index === index ? draft.editing.config : null) ?? draft.alarm.missions[index] ?? null) : null;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState(false);
  const rng = useMemo(() => randomRng(), []);
  useEffect(() => {
    if (!config) navigate(`/alarm/${id}`, { replace: true });
  }, [config, id]);
  if (!config) return null;
  const back = () => goBack(`/alarm/${id}/missions/${index}`);
  if (done) {
    return (
      <Screen title="Practice done" chrome="none">
        <p class="row ok-text" style="font-size: var(--fs-xl)">
          <Icon name="check-circle" size={40} />
          Done
        </p>
        <p>That's how it works when the alarm rings.</p>
        <Button variant="primary" block onClick={back} data-initial-focus="">
          Back to mission
        </Button>
      </Screen>
    );
  }
  return (
    <Screen title={`Practice · ${missionName(config.type)}`} chrome="none" customHeading>
      <div class="stack">
        <Strip
          left={
            <>
              Practice · {missionName(config.type)}
            </>
          }
          right={progress ? `${progress.done} of ${progress.total}` : ''}
        />
        <div class="row-between">
          <StatusPill tone="info" text="Practice" icon="info" />
          <Button variant="text" onClick={back}>
            End practice
          </Button>
        </div>
        <MissionView
          config={config}
          rng={rng}
          practice
          onSuccess={() => setDone(true)}
          onFailure={() => undefined}
          onActivity={() => undefined}
          onProgress={(d, tot) => setProgress((p) => (p && p.done === d && p.total === tot ? p : { done: d, total: tot }))}
          onUnavailable={() => undefined}
          onUseBackup={back}
        />
      </div>
    </Screen>
  );
}
