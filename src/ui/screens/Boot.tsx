/** Pre-app states rendered by main.tsx before the service is ready. */
import { useEffect, useState } from 'preact/hooks';
import { Banner } from '../components/layout';

export function BootSplash() {
  // Skeletons only after 150 ms so a fast start shows nothing (design.md §3.2 Loading).
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(t);
  }, []);
  return (
    <div class="shell">
      <main id="main" class="shell-main" aria-busy="true">
        <h1 class="visually-hidden">Loading Rouse</h1>
        {show && [0, 1, 2].map((i) => <div key={i} class="skeleton" aria-hidden="true" />)}
      </main>
    </div>
  );
}

export function BootError({ onRetry }: { onRetry: () => void }) {
  return (
    <div class="shell">
      <main id="main" class="shell-main">
        <h1 tabIndex={-1}>Alarms</h1>
        <Banner
          tone="error"
          action={
            <button type="button" class="btn btn-secondary" onClick={onRetry}>
              Try again
            </button>
          }
        >
          Couldn't load your alarms. Alarms already set will still ring.
        </Banner>
      </main>
    </div>
  );
}
