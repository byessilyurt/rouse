/**
 * Camera QR/barcode scanner (plan §2.2): getUserMedia → BarcodeDetector when available, else jsQR on a
 * canvas downscaled to 640 px at ~8 fps. Torch toggle when the track supports it.
 * e2e: listens for `rouse:test-scan` window events (window.__rouseTest.injectScan) in every state.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton } from '../components/Button';
import { Spinner } from '../components/layout';

export type ScannerState = 'starting' | 'running' | 'denied' | 'nocamera' | 'error';
export const TEST_SCAN_EVENT = 'rouse:test-scan';

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** True when the e2e test hooks are installed (no physical camera in CI). */
export function simulatedCamera(): boolean {
  return typeof window !== 'undefined' && !!window.__rouseTest;
}

type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

async function createDecoder(canvas: HTMLCanvasElement): Promise<Decoder> {
  const BD = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (BD) {
    try {
      const formats = (await BD.getSupportedFormats?.()) ?? undefined;
      const det = new BD(formats && formats.length ? { formats } : undefined);
      return async (video) => {
        const res = await det.detect(video);
        return res[0]?.rawValue ?? null;
      };
    } catch {
      /* fall through to jsQR */
    }
  }
  const { default: jsQR } = await import('jsqr');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return null;
    const scale = Math.min(1, 640 / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const code = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    return code?.data ?? null;
  };
}

export interface QrScannerProps {
  onCode: (text: string) => void;
  /** Freeze the preview and stop decoding. */
  paused?: boolean;
  onStateChange?: (s: ScannerState) => void;
  /** Bumping this retries the camera (after "Allow camera"). */
  retryKey?: number;
}

export function QrScanner({ onCode, paused = false, onStateChange, retryKey = 0 }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<ScannerState>('starting');
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hint, setHint] = useState(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const update = (s: ScannerState) => {
    setState(s);
    onStateChange?.(s);
  };

  // Injected codes (e2e) work regardless of camera state.
  useEffect(() => {
    const onTest = (e: Event) => {
      if (pausedRef.current) return;
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === 'string') onCodeRef.current(text);
    };
    window.addEventListener(TEST_SCAN_EVENT, onTest);
    return () => window.removeEventListener(TEST_SCAN_EVENT, onTest);
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    let loop: ReturnType<typeof setTimeout> | null = null;
    update('starting');
    setHint(false);
    const hintTimer = setTimeout(() => setHint(true), 20_000);
    (async () => {
      if (simulatedCamera()) {
        // e2e harness: no camera in CI; codes arrive through window.__rouseTest.injectScan.
        update('running');
        return;
      }
      const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
      if (!md?.getUserMedia) {
        update('nocamera');
        return;
      }
      try {
        stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string }).name;
        update(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' ? 'nocamera' : 'error');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* autoplay of a muted inline video is allowed; ignore */
      }
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchAvailable(!!caps.torch);
      update('running');
      canvasRef.current = canvasRef.current ?? document.createElement('canvas');
      const decode = await createDecoder(canvasRef.current);
      const tick = async () => {
        if (cancelled) return;
        if (!pausedRef.current && video.readyState >= 2) {
          try {
            const text = await decode(video);
            if (text && !pausedRef.current && !cancelled) {
              try {
                navigator.vibrate?.(40);
              } catch {
                /* ignore */
              }
              onCodeRef.current(text);
            }
          } catch {
            /* transient decode errors */
          }
        }
        loop = setTimeout(() => void tick(), 125);
      };
      void tick();
    })();
    return () => {
      cancelled = true;
      clearTimeout(hintTimer);
      if (loop) clearTimeout(loop);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, [retryKey]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || state !== 'running') return;
    if (paused) v.pause();
    else void v.play().catch(() => undefined);
  }, [paused, state]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  return (
    <div class="stack-sm">
      <div class="camera-box">
        <video ref={videoRef} muted playsInline autoplay aria-hidden="true" />
        {state === 'running' && <div class="camera-guide" aria-hidden="true" />}
        {state === 'starting' && (
          <div class="camera-status">
            <Spinner label="Starting camera…" />
          </div>
        )}
        {state === 'running' && torchAvailable && (
          <IconButton class="camera-torch" size={64} icon="flashlight" label={torchOn ? 'Turn off light' : 'Turn on light'} pressed={torchOn} onClick={toggleTorch} />
        )}
      </div>
      {state === 'running' && hint && <p class="muted" role="status">Having trouble? Turn on the light or move a bit further away.</p>}
    </div>
  );
}
