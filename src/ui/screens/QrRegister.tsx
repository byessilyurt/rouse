/** QR register / test scan (design.md §3.5 "QR register"). */
import { useEffect, useReducer, useState } from 'preact/hooks';
import { codesMatch, describeCode, normalizeCode } from '../../missions/qr';
import { Button } from '../components/Button';
import { Screen } from '../components/layout';
import { Sheet } from '../components/overlays';
import { announce } from '../components/feedback';
import { useApp } from '../context';
import { Icon } from '../icons';
import { goBack, navigate } from '../router';
import { getDraft, setEditing, subscribeDraft } from '../draft';
import { QrScanner, type ScannerState } from '../missions/QrScanner';

function preview(text: string): string {
  try {
    return describeCode(text);
  } catch {
    return text.length > 24 ? `${text.slice(0, 23)}…` : text;
  }
}

export function QrRegister({ id, index, test }: { id: string; index: number; test: boolean }) {
  const { caps } = useApp();
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeDraft(() => force(0)), []);
  const draft = getDraft();
  const ed = draft?.key === id ? draft.editing : null;
  const qr = ed?.config?.type === 'qr' ? ed.config : null;
  const [found, setFound] = useState<string | null>(null);
  const [state, setState] = useState<ScannerState>('starting');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!qr) navigate(`/alarm/${id}/missions/${index}`, { replace: true });
  }, [qr, id, index]);
  if (!qr || !ed) return null;

  const back = () => goBack(`/alarm/${id}/missions/${index}`);
  const match = found != null && qr.expectedCode ? safeMatch(qr.expectedCode, found) : false;
  const where = qr.label || 'the spot you chose';

  const onCode = (text: string) => {
    setFound(text);
    if (test) announce(safeMatch(qr.expectedCode, text) ? "That's the one." : `Different code. This alarm wants the one at ${where}.`, 'assertive');
    else announce('Code found', 'assertive');
  };

  return (
    <Screen title={test ? 'Test scan' : 'Scan a code'} chrome="top" onBack={back}>
      {(state === 'denied' || state === 'nocamera' || state === 'error') && (
        <div class="stack">
          {state === 'denied' ? (
            <>
              <h2>Rouse can't use the camera</h2>
              <p>Allow camera access to register a code.</p>
              <Button
                variant="primary"
                block
                icon="camera"
                onClick={() => {
                  setRetry((n) => n + 1);
                }}
              >
                Allow camera
              </Button>
            </>
          ) : (
            <p class="row">
              <Icon name="info" />
              {state === 'nocamera' ? 'This phone has no camera Rouse can use.' : "The camera didn't start. Try again."}
            </p>
          )}
          <Button variant="secondary" block onClick={back}>
            Cancel
          </Button>
        </div>
      )}
      <div hidden={state === 'denied' || state === 'nocamera' || state === 'error'}>
        <QrScanner
          onCode={onCode}
          paused={found !== null}
          retryKey={retry}
          onStateChange={(s) => {
            setState(s);
            if (s === 'denied' || s === 'nocamera') caps.markCameraUnavailable();
          }}
        />
      </div>
      <p>{test ? `Scan the code at ${where}.` : 'Point at a QR code or barcode.'}</p>

      <Sheet
        open={found !== null}
        title={test ? (match ? "That's the one. ✓" : 'Different code') : 'Code found'}
        onClose={() => setFound(null)}
      >
        {test ? (
          <p data-testid="test-scan-result">{match ? "That's the one. ✓" : `Different code. This alarm wants the one at ${where}.`}</p>
        ) : (
          <p>
            <span class="muted">Code: </span>
            <code data-testid="code-preview">{found ? preview(found) : ''}</code>
          </p>
        )}
        <div class="stack-sm">
          {test ? (
            <Button variant="primary" block onClick={back}>
              Done
            </Button>
          ) : (
            <Button
              variant="primary"
              block
              onClick={() => {
                if (!found) return;
                let code = found;
                try {
                  code = normalizeCode(found);
                } catch {
                  code = found.trim();
                }
                setEditing({ ...ed, config: { ...qr, expectedCode: code } });
                setFound(null);
                back();
              }}
            >
              Use this code
            </Button>
          )}
          <Button variant="secondary" block onClick={() => setFound(null)}>
            Scan again
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}

function safeMatch(expected: string, scanned: string): boolean {
  try {
    return codesMatch(expected, scanned);
  } catch {
    return expected.trim() === scanned.trim() && expected.length > 0;
  }
}
