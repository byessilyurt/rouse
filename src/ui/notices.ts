/** One-shot notices carried across a navigation (e.g. editor save → alarm list banner). */
export type Notice = 'sync-failed' | 'restored-check-reliability';

let pending: Notice | null = null;

export function setNotice(n: Notice | null): void {
  pending = n;
}

export function takeNotice(): Notice | null {
  const n = pending;
  pending = null;
  return n;
}
