/**
 * Button / IconButton (design.md §5). Disabled state uses aria-disabled so controls stay focusable;
 * clicks are swallowed and the reason is shown next to the control by the caller.
 */
import type { ComponentChildren, HTMLAttributes, Ref, TargetedMouseEvent } from 'preact';
import { Icon, type IconName } from '../icons';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger' | 'danger-outline' | 'danger-text';
export type ButtonSize = 'md' | 'ring' | 'ring-primary';

export interface ButtonProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'size' | 'icon' | 'ref' | 'role' | 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  subLabel?: ComponentChildren;
  block?: boolean;
  ariaDisabled?: boolean;
  children?: ComponentChildren;
  btnRef?: Ref<HTMLButtonElement>;
  type?: 'button' | 'submit';
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  subLabel,
  block,
  ariaDisabled,
  children,
  class: cls,
  onClick,
  btnRef,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn-${variant}`];
  if (size !== 'md') classes.push(`btn-${size}`);
  if (block) classes.push('btn-block');
  if (cls) classes.push(String(cls));
  const handle = (e: TargetedMouseEvent<HTMLButtonElement>) => {
    if (ariaDisabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button
      {...rest}
      ref={btnRef}
      type={type}
      class={classes.join(' ')}
      aria-disabled={ariaDisabled ? 'true' : undefined}
      onClick={handle}
    >
      {icon && <Icon name={icon} size={size === 'md' ? 22 : 28} />}
      {subLabel ? (
        <span class="btn-label">
          <span>{children}</span>
          <span class="btn-sub">{subLabel}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}

export interface IconButtonProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'size' | 'icon' | 'label' | 'role' | 'type'> {
  icon: IconName;
  label: string;
  size?: 48 | 64;
  pressed?: boolean;
  plain?: boolean;
  ariaDisabled?: boolean;
}

export function IconButton({ icon, label, size = 48, pressed, plain, ariaDisabled, class: cls, onClick, ...rest }: IconButtonProps) {
  const classes = ['icon-btn'];
  if (size === 64) classes.push('size-64');
  if (plain) classes.push('plain');
  if (cls) classes.push(String(cls));
  return (
    <button
      {...rest}
      type="button"
      class={classes.join(' ')}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed ? 'true' : 'false'}
      aria-disabled={ariaDisabled ? 'true' : undefined}
      onClick={(e) => {
        if (ariaDisabled) return;
        onClick?.(e);
      }}
    >
      <Icon name={icon} size={size === 64 ? 32 : 24} />
    </button>
  );
}
