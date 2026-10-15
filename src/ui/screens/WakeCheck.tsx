/** Wake-up check prompt (design.md §3.11, D-034: one tap). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { ProgressRing, Screen } from '../components/layout';
import { announce } from '../components/feedback';
import { useApp, useNow, useRingManager } from '../context';
import { formatClockCountdown } from '../format';
import { navigate } from '../router';

export function WakeCheckScreen() {
  const { backend } = useApp();
  const mgr = useRingManager();
  const t = useNow(1000);
  const ring = mgr.getRing();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spoken = useRef(new Set<number>());

  const prompt = ring?.state === 'wake-check-prompt' || ring?.state === 'wake-check-wait' ? ring : null;
  const deadline = prompt?.wakeCheckDeadlineAt ?? null;
  const totalMs = (prompt?.alarm.wakeUpCheck.windowMin ?? 1) * 60_000;
  const remaining = deadline != null ? Math.max(0, deadline - t) : totalMs;
  const secs = Math.ceil(remaining / 1000);

  useEffect(() => {
    for (const mark of [60, 30, 10]) {
      if (secs === mark && !spoken.current.has(mark)) {
        spoken.current.add(mark);
        announce(`${mark} seconds left to answer`, 'polite');
      }
    }
  }, [secs]);

  useEffect(() => {
    if (!confirmed) return;
    const tm = setTimeout(() => navigate('/alarms', { replace: true }), 2000);
    return () => clearTimeout(tm);
  }, [confirmed]);

  if (confirmed) {
    return (
      <Screen title="Still up?" chrome="none" customHeading>
        <div role="status">
          <h1 tabIndex={-1}>Nice. Have a good day.</h1>
        </div>
      </Screen>
    );
  }
  if (!prompt) {
    return (
      <Screen title="Still up?" chrome="none">
        <p>There's no wake-up check right now.</p>
        <Button variant="primary" block onClick={() => navigate('/alarms', { replace: true })}>
          Go to alarms
        </Button>
      </Screen>
    );
  }
  return (
    <Screen title="Still up?" chrome="locked">
      <ProgressRing
        mode="timer"
        value={remaining}
        max={totalMs}
        label={`Time to answer: ${formatClockCountdown(remaining)}`}
        center={<span class="big">{formatClockCountdown(remaining)}</span>}
      />
      {error && <p class="error-text">{error}</p>}
      <Button
        variant="primary"
        size="ring-primary"
        block
        data-initial-focus=""
        onClick={async () => {
          try {
            await backend.confirmAwake(prompt.sessionId);
            setConfirmed(true);
            announce('Nice. Have a good day.', 'polite');
          } catch {
            setError("Couldn't confirm. Try again.");
          }
        }}
      >
        I'm awake
      </Button>
      <p class="center">If you don't answer, the alarm rings again with your mission.</p>
    </Screen>
  );
}
