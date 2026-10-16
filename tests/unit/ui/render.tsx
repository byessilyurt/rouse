/** Minimal render helper (no @testing-library): preact render into a container, wrapped in act(). */
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';

export interface Rendered {
  container: HTMLElement;
  rerender(vnode: ComponentChild): Promise<void>;
  unmount(): void;
  byRole(role: string, name?: string | RegExp): HTMLElement;
  allByRole(role: string, name?: string | RegExp): HTMLElement[];
  text(): string;
}

const IMPLICIT: Record<string, string> = { button: 'button', a: 'link', input: 'textbox', textarea: 'textbox', h1: 'heading', h2: 'heading', li: 'listitem', select: 'combobox' };

export function roleOf(el: Element): string | null {
  return el.getAttribute('role') ?? IMPLICIT[el.tagName.toLowerCase()] ?? null;
}

export function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by) return by.split(' ').map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').trim();
  const input = el as HTMLInputElement;
  if (input.labels && input.labels.length) return input.labels[0]!.textContent?.trim() ?? '';
  return el.textContent?.trim() ?? '';
}

export async function mount(vnode: ComponentChild): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(() => {
    render(vnode, container);
  });
  // Sheets and dialogs are portalled to <body>; search them too (but not other tests' containers).
  const scope = () => [...container.querySelectorAll('*'), ...[...document.body.children].filter((c) => c.matches('.scrim, .sheet, .dialog')).flatMap((c) => [c, ...c.querySelectorAll('*')])];
  const all = (role: string, name?: string | RegExp) =>
    scope().filter((el) => {
      if (roleOf(el) !== role) return false;
      if (name === undefined) return true;
      const n = nameOf(el);
      return typeof name === 'string' ? n === name : name.test(n);
    }) as HTMLElement[];
  return {
    container,
    async rerender(v) {
      await act(() => {
        render(v, container);
      });
    },
    unmount() {
      render(null, container);
      container.remove();
    },
    byRole(role, name) {
      const found = all(role, name);
      if (found.length !== 1) throw new Error(`Expected 1 ${role} named ${String(name)}, found ${found.length}`);
      return found[0]!;
    },
    allByRole: all,
    text: () => container.textContent ?? '',
  };
}

export async function click(el: Element, init: MouseEventInit = {}): Promise<void> {
  await act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, ...init }));
  });
}

export async function key(el: Element, k: string): Promise<void> {
  await act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

export async function input(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(() => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
