import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../../../src/ui/clipboard';

describe('copyText', () => {
  const nav = navigator as Navigator & { clipboard?: unknown };
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
  const setClipboard = (value: unknown) => Object.defineProperty(nav, 'clipboard', { value, configurable: true });

  afterEach(() => {
    delete (nav as { clipboard?: unknown }).clipboard;
    if (original) Object.defineProperty(Navigator.prototype, 'clipboard', original);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('uses navigator.clipboard when it works', async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to a selected textarea + execCommand when the clipboard API rejects', async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    let copied = '';
    document.execCommand = vi.fn((cmd: string) => {
      const ta = document.querySelector('textarea')!;
      copied = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      return cmd === 'copy';
    });
    expect(await copyText('fallback text')).toBe(true);
    expect(copied).toBe('fallback text');
    expect(document.querySelector('textarea')).toBeNull(); // cleaned up
  });

  it('falls back when navigator.clipboard is missing, and reports failure when copy is refused', async () => {
    document.execCommand = vi.fn(() => false);
    expect(await copyText('x')).toBe(false);
    document.execCommand = vi.fn(() => {
      throw new Error('blocked');
    });
    expect(await copyText('x')).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
