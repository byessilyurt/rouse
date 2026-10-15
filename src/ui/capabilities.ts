/**
 * Device capability probing for the UI (plan §2.2): devicemotion (1 s probe; any event later flips it
 * on) and camera presence. Feeds RingController's DeviceCapabilities and the mission picker.
 */
import type { DeviceCapabilities } from '../core/ringController';
import type { MotionSample } from '../missions/motion';

type Listener = () => void;
type SampleListener = (s: MotionSample) => void;

export class CapabilityStore {
  private state: DeviceCapabilities & { motionProbed: boolean; cameraProbed: boolean } = {
    motion: false,
    camera: false,
    motionProbed: false,
    cameraProbed: false,
  };
  private listeners = new Set<Listener>();
  private sampleListeners = new Set<SampleListener>();
  private installed = false;

  constructor(private readonly opts: { testMode?: boolean } = {}) {}

  get(): DeviceCapabilities {
    return { motion: this.state.motion, camera: this.state.camera };
  }
  get motionProbed(): boolean {
    return this.state.motionProbed;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private set(patch: Partial<typeof this.state>) {
    const before = JSON.stringify(this.state);
    this.state = { ...this.state, ...patch };
    if (JSON.stringify(this.state) !== before) for (const l of this.listeners) l();
  }

  /** Install the global devicemotion listener and start both probes. Idempotent. */
  start(probeMs = 1000): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    window.addEventListener('devicemotion', this.onMotion);
    setTimeout(() => this.set({ motionProbed: true }), probeMs);
    void this.probeCamera();
  }

  stop(): void {
    if (typeof window !== 'undefined') window.removeEventListener('devicemotion', this.onMotion);
    this.installed = false;
  }

  private onMotion = (e: Event) => {
    const ev = e as DeviceMotionEvent;
    const a = ev.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    if (!this.state.motion) this.set({ motion: true, motionProbed: true });
    const sample: MotionSample = { t: ev.timeStamp || performance.now(), x: a.x, y: a.y, z: a.z };
    for (const l of this.sampleListeners) l(sample);
  };

  /** Subscribe to accelerometer samples (for motion missions). */
  onSample(l: SampleListener): () => void {
    this.sampleListeners.add(l);
    return () => this.sampleListeners.delete(l);
  }

  async probeCamera(): Promise<boolean> {
    let camera = false;
    if (this.opts.testMode) {
      // e2e: no physical camera in CI; codes arrive via window.__rouseTest.injectScan.
      camera = true;
    } else {
      try {
        const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
        camera = devices.some((d) => d.kind === 'videoinput');
      } catch {
        camera = false;
      }
    }
    this.set({ camera, cameraProbed: true });
    return camera;
  }

  /** The camera failed at runtime (denied / unplugged). */
  markCameraUnavailable(): void {
    if (!this.opts.testMode) this.set({ camera: false });
  }

  /** iOS-style permission prompt for motion sensors; no-op elsewhere. */
  async requestMotionPermission(): Promise<boolean> {
    const DME = (typeof window !== 'undefined' ? (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent : undefined);
    if (DME?.requestPermission) {
      try {
        return (await DME.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return this.state.motion;
  }
}
