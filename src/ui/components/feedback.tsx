/**
 * LiveRegions (announce) and the Toast singleton (design.md §5).
 */
import { useEffect, useState } from 'preact/hooks';

const timers: Record<'polite' | 'assertive', ReturnType<typeof setTimeout> | undefined> = { polite: undefined, assertive: undefined };

/** Clear the region, then set the text after 50 ms so repeated messages are re-announced. */
export function announce(text: string, politeness: 'polite' | 'assertive' = 'polite'): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(`live-${politeness}`);
  if (!el) return;
  el.textContent = '';
  clearTimeout(timers[politeness]);
  timers[politeness] = setTimeout(() => {
    el.textContent = text;
  }, 50);
}

export function LiveRegions() {
  return (
    <>
      <div id="live-polite" class="visually-hidden" aria-live="polite" aria-atomic="true" />
      <div id="live-assertive" class="visually-hidden" aria-live="assertive" aria-atomic="true" />
    </>
  );
}

type ToastListener = (text: string | null) => void;
const toastListeners = new Set<ToastListener>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let currentToast: string | null = null;

/** Show a toast for 4 s. A new toast replaces the current one (never stacked). */
export function toast(text: string): void {
  currentToast = text;
  clearTimeout(toastTimer);
  for (const l of toastListeners) l(text);
  toastTimer = setTimeout(() => {
    currentToast = null;
    for (const l of toastListeners) l(null);
  }, 4000);
}

export function ToastHost({ hidden }: { hidden?: boolean }) {
  const [text, setText] = useState<string | null>(currentToast);
  useEffect(() => {
    toastListeners.add(setText);
    return () => {
      toastListeners.delete(setText);
    };
  }, []);
  return (
    <div class="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {!hidden && text ? (
        <div class="toast" data-testid="toast">
          {text}
        </div>
      ) : null}
    </div>
  );
}
