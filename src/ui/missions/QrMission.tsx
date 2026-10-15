/** QR scan mission (design.md §3.7 QR scan). */
import { useRef, useState } from 'preact/hooks';
import type { QrMissionConfig } from '../../core/types';
import { codesMatch } from '../../missions/qr';
import { Button } from '../components/Button';
import { useApp } from '../context';
import { QrScanner, type ScannerState } from './QrScanner';
import { Feedback, useFeedback, type MissionProps } from './common';

export function QrMission({ config, onSuccess, onFailure, onActivity, onUnavailable, onUseBackup }: MissionProps<QrMissionConfig> & { onUseBackup: () => void }) {
  const { caps } = useApp();
  const [fb, setFb] = useFeedback();
  const [state, setState] = useState<ScannerState>('starting');
  const [retry, setRetry] = useState(0);
  const done = useRef(false);
  const lastWrong = useRef<{ code: string; at: number } | null>(null);
  const where = config.label || 'the spot you chose';

  const onCode = (text: string) => {
    onActivity();
    if (done.current) return;
    let ok = false;
    try {
      ok = codesMatch(config.expectedCode, text);
    } catch {
      ok = false;
    }
    if (ok) {
      done.current = true;
      setFb(null);
      onSuccess();
      return;
    }
    // A wrong code held in front of the camera counts once, not 8 times a second.
    const now = Date.now();
    if (lastWrong.current && lastWrong.current.code === text && now - lastWrong.current.at < 3000) return;
    lastWrong.current = { code: text, at: now };
    setFb(`That's a different code. Find the one at ${where}.`);
    onFailure('wrong-code');
  };

  const broken = state === 'denied' || state === 'nocamera' || state === 'error';
  return (
    <div class="mission-content">
      <p class="center">Scan the code at {where}</p>
      {broken && (
        <div class="stack-sm">
          <p>Rouse can't use the camera right now.</p>
          <Button variant="secondary" block icon="camera" onClick={() => setRetry((n) => n + 1)}>
            Allow camera
          </Button>
          <Button variant="primary" size="ring" block onClick={onUseBackup}>
            Use backup mission
          </Button>
        </div>
      )}
      <div hidden={broken}>
        <QrScanner
          onCode={onCode}
          retryKey={retry}
          onStateChange={(s) => {
            setState(s);
            if (s === 'denied' || s === 'nocamera' || s === 'error') {
              caps.markCameraUnavailable();
              onUnavailable('camera');
            }
          }}
        />
      </div>
      <Feedback text={fb.text} k={fb.key} />
    </div>
  );
}
