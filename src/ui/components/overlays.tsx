/**
 * Sheet (bottom sheet) and Dialog (design.md §5). Modal, focus-trapped, restore focus on close.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { Button, type ButtonVariant } from './Button';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useModal(open: boolean, onClose: (() => void) | undefined, dismissible: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const initial = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!el) return;
      if (e.key === 'Escape' && dismissible && onClose) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);
  return ref;
}

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /** Locked routes: no Esc/scrim close. */
  dismissible?: boolean;
}

export function Sheet({ open, title, onClose, children, footer, dismissible = true }: SheetProps) {
  const titleId = useId();
  const ref = useModal(open, onClose, dismissible);
  if (!open) return null;
  return (
    <>
      <div class="scrim" onClick={dismissible ? onClose : undefined} aria-hidden="true" />
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {footer}
      </div>
    </>
  );
}

export interface DialogAction {
  label: string;
  variant: ButtonVariant;
  onClick: () => void;
  autofocus?: boolean;
}

export interface DialogProps {
  open: boolean;
  title: string;
  body?: ComponentChildren;
  actions: DialogAction[];
  /** Destructive dialogs use role=alertdialog. */
  destructive?: boolean;
  onClose?: () => void;
}

export function Dialog({ open, title, body, actions, destructive, onClose }: DialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const ref = useModal(open, onClose, true);
  if (!open) return null;
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={onClose} />
      <div
        class="dialog"
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        ref={ref}
      >
        <h2 id={titleId}>{title}</h2>
        {body && <div id={bodyId}>{body}</div>}
        <div class="dialog-actions">
          {actions.map((a, i) => (
            <Button key={a.label} variant={a.variant} block onClick={a.onClick} data-autofocus={a.autofocus || (i === 0 && !actions.some((x) => x.autofocus)) ? '' : undefined}>
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}
