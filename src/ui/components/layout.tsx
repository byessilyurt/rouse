/**
 * Layout & display components (design.md §5): Screen shell, TopBar, TabBar, Card, ListRow, Banner,
 * StatusPill, CheckRow, ProgressRing, IdleMeter, Spinner.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';
import { Icon, type IconName } from '../icons';
import { IconButton } from './Button';
import { ToastHost } from './feedback';

// ── Screen shell ──────────────────────────────────────────────────────────
export interface ScreenProps {
  /** H1 text; also the document title. */
  title: string;
  /** 'tabs' = tab routes; 'top' = top bar with Back; 'none' = no chrome; 'locked' = ring routes. */
  chrome: 'tabs' | 'top' | 'none' | 'locked';
  /** Where Back goes (top chrome). */
  onBack?: () => void;
  topAction?: ComponentChildren;
  /** Render the H1 yourself (e.g. alarm list header row). */
  customHeading?: boolean;
  children: ComponentChildren;
  sticky?: ComponentChildren;
  currentTab?: 'alarms' | 'stats' | 'settings';
  class?: string;
}

export function Screen({ title, chrome, onBack, topAction, customHeading, children, sticky, currentTab, class: cls }: ScreenProps) {
  useEffect(() => {
    document.title = `${title} · Rouse`;
  }, [title]);
  const mainClasses = ['shell-main'];
  if (chrome === 'tabs') mainClasses.push('has-tabs');
  if (sticky) mainClasses.push('has-sticky');
  if (cls) mainClasses.push(cls);
  return (
    <div class={`shell${chrome === 'locked' ? ' locked' : ''}`}>
      {chrome === 'top' && (
        <header class="topbar">
          <div class="topbar-inner">
            <IconButton icon="chevron-left" label="Back" plain onClick={onBack} />
            <h1 tabIndex={-1}>{title}</h1>
            <div class="topbar-action">{topAction}</div>
          </div>
        </header>
      )}
      <main id="main" class={mainClasses.join(' ')}>
        {chrome !== 'top' && !customHeading && <h1 tabIndex={-1}>{title}</h1>}
        {children}
      </main>
      {sticky && <div class="sticky-bar">{sticky}</div>}
      {chrome === 'tabs' && <TabBar current={currentTab ?? 'alarms'} />}
      <ToastHost hidden={chrome === 'locked'} />
    </div>
  );
}

// ── TabBar ────────────────────────────────────────────────────────────────
const TABS: { key: 'alarms' | 'stats' | 'settings'; href: string; label: string; icon: IconName }[] = [
  { key: 'alarms', href: '#/alarms', label: 'Alarms', icon: 'alarm-clock' },
  { key: 'stats', href: '#/stats', label: 'Stats', icon: 'bar-chart' },
  { key: 'settings', href: '#/settings', label: 'Settings', icon: 'sliders' },
];

export function TabBar({ current }: { current: 'alarms' | 'stats' | 'settings' }) {
  return (
    <nav class="tabbar" aria-label="Main">
      <ul>
        {TABS.map((t) => (
          <li key={t.key}>
            <a href={t.href} aria-current={current === t.key ? 'page' : undefined}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── Card / ListRow ────────────────────────────────────────────────────────
export function Card({ children, class: cls, ...rest }: JSX.HTMLAttributes<HTMLDivElement> & { children?: ComponentChildren }) {
  return (
    <div {...rest} class={`card${cls ? ` ${cls}` : ''}`}>
      {children}
    </div>
  );
}

export interface ListRowProps {
  title: ComponentChildren;
  value?: ComponentChildren;
  description?: ComponentChildren;
  href?: string;
  onClick?: () => void;
  trailing?: ComponentChildren;
  icon?: IconName;
  ariaLabel?: string;
  external?: boolean;
}

export function ListRow({ title, value, description, href, onClick, trailing, icon, ariaLabel, external }: ListRowProps) {
  const inner = (
    <>
      {icon && <Icon name={icon} />}
      <span class="grow stack-sm" style="gap: 2px">
        <span class="list-row-title">{title}</span>
        {description && <span class="list-row-desc">{description}</span>}
      </span>
      {value !== undefined && <span class="list-row-value">{value}</span>}
      {trailing}
      {(href || onClick) && !trailing && <Icon name={external ? 'external-link' : 'chevron-right'} size={20} />}
    </>
  );
  if (href) {
    return (
      <a class="list-row" href={href} aria-label={ariaLabel} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
        {inner}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" class="list-row" aria-label={ariaLabel} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div class="list-row">{inner}</div>;
}

// ── Banner ────────────────────────────────────────────────────────────────
export type Tone = 'info' | 'ok' | 'warn' | 'error';
const TONE_ICON: Record<Tone, IconName> = { info: 'info', ok: 'check-circle', warn: 'alert-triangle', error: 'x-octagon' };

export interface BannerProps {
  tone: Tone;
  title?: ComponentChildren;
  children?: ComponentChildren;
  action?: ComponentChildren;
  /** Use role=alert (only for errors that appear after a user action). */
  alert?: boolean;
  collapsible?: { collapsedText: string; storageKey?: string };
  testId?: string;
}

export function Banner({ tone, title, children, action, alert, collapsible, testId }: BannerProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!collapsible?.storageKey) return false;
    try {
      return localStorage.getItem(collapsible.storageKey) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (collapsible?.storageKey) {
      try {
        localStorage.setItem(collapsible.storageKey, next ? '1' : '0');
      } catch {
        /* per-viewer convenience only */
      }
    }
  };
  return (
    <div class={`banner tone-${tone}`} role={alert ? 'alert' : 'status'} data-testid={testId}>
      {!(collapsible && collapsed) && <Icon name={TONE_ICON[tone]} />}
      <div class="banner-body">
        {collapsible && collapsed ? (
          <button type="button" class="banner-collapse" aria-expanded="false" onClick={toggle}>
            <Icon name="info" size={20} />
            <span class="grow">{collapsible.collapsedText}</span>
            <Icon name="chevron-down" size={20} />
          </button>
        ) : (
          <>
            {title && <p class="banner-title">{title}</p>}
            {children && <div>{children}</div>}
            {action}
            {collapsible && (
              <button type="button" class="btn btn-text" aria-expanded="true" onClick={toggle} style="align-self: flex-start">
                Show less
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── StatusPill ────────────────────────────────────────────────────────────
export interface StatusPillProps {
  tone: Tone;
  text: string;
  href?: string;
  ariaLabel?: string;
  icon?: IconName;
}

export function StatusPill({ tone, text, href, ariaLabel, icon }: StatusPillProps) {
  const ic = <Icon name={icon ?? TONE_ICON[tone]} size={18} />;
  if (href) {
    return (
      <a class={`pill tone-${tone}`} href={href} aria-label={ariaLabel}>
        <span class="pill-inner">
          {ic}
          {text}
        </span>
      </a>
    );
  }
  return (
    <span class={`pill tone-${tone}`} aria-label={ariaLabel}>
      {ic}
      {text}
    </span>
  );
}

// ── CheckRow ──────────────────────────────────────────────────────────────
export type CheckStatus = 'ok' | 'warn' | 'error' | 'unknown' | 'unsupported';
const STATUS_ICON: Record<CheckStatus, IconName> = {
  ok: 'check-circle',
  warn: 'alert-triangle',
  error: 'x-octagon',
  unknown: 'help-circle',
  unsupported: 'info',
};
export const STATUS_WORD: Record<CheckStatus, string> = {
  ok: 'OK',
  warn: 'Needs attention',
  error: 'Blocked',
  unknown: 'Unknown',
  unsupported: 'Not in web demo',
};

export interface CheckRowProps {
  status: CheckStatus;
  title: string;
  statusText?: string;
  detail: string;
  fix?: { label: string; onClick: () => void } | null;
  pending?: boolean;
}

export function CheckRow({ status, title, statusText, detail, fix, pending }: CheckRowProps) {
  const word = pending ? 'Checking…' : (statusText ?? STATUS_WORD[status]);
  return (
    <li class="checkrow" aria-label={`${title}: ${word}. ${pending ? '' : detail}`.trim()}>
      <span class={`status-${pending ? 'unknown' : status}`}>{pending ? <Spinner /> : <Icon name={STATUS_ICON[status]} />}</span>
      <div class="checkrow-body">
        <span class="list-row-title">{title}</span>
        <span class={`status-word status-${pending ? 'unknown' : status}`}>{word}</span>
        {!pending && <span class="list-row-desc">{detail}</span>}
      </div>
      {fix && !pending && (
        <button type="button" class="btn btn-secondary" onClick={fix.onClick}>
          {fix.label}
        </button>
      )}
    </li>
  );
}

// ── ProgressRing ──────────────────────────────────────────────────────────
export interface ProgressRingProps {
  value: number;
  max: number;
  size?: number;
  label: string;
  center: ComponentChildren;
  mode?: 'progress' | 'timer';
  valueText?: string;
}

export function ProgressRing({ value, max, size = 240, label, center, mode = 'progress', valueText }: ProgressRingProps) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const roleProps =
    mode === 'timer'
      ? { role: 'timer', 'aria-label': label }
      : {
          role: 'progressbar',
          'aria-label': label,
          'aria-valuenow': value,
          'aria-valuemin': 0,
          'aria-valuemax': max,
          'aria-valuetext': valueText,
        };
  return (
    <div class="progress-ring" style={`width: ${size}px; height: ${size}px; max-width: 100%`} {...roleProps}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" stroke-width={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          stroke-width={stroke}
          stroke-linecap="round"
          stroke-dasharray={`${c} ${c}`}
          stroke-dashoffset={String(c * (1 - frac))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div class="progress-ring-center">{center}</div>
    </div>
  );
}

// ── IdleMeter ─────────────────────────────────────────────────────────────
export interface IdleMeterProps {
  remainingMs: number;
  totalMs?: number;
  state: 'quiet' | 'warning' | 'ringing';
}

export function IdleMeter({ remainingMs, totalMs = 30_000, state }: IdleMeterProps) {
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
  const secs = Math.max(0, Math.ceil(remainingMs / 1000));
  const icon: IconName = state === 'quiet' ? 'volume-x' : state === 'warning' ? 'alert-triangle' : 'volume-2';
  const text =
    state === 'quiet' ? 'Sound off while you work' : state === 'warning' ? `Alarm returns in ${secs} s` : 'Alarm is back. Keep going to turn it off.';
  return (
    <div class={`idle-meter ${state}`} data-testid="idle-meter" data-state={state}>
      <p class="idle-meter-text">
        <Icon name={icon} size={18} />
        <span>{text}</span>
      </p>
      <div class="idle-bar" aria-hidden="true">
        <span style={`width: ${pct}%`} />
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const id = useId();
  return (
    <span class="row" style="gap: 8px">
      <span class="spinner" aria-hidden="true" />
      {label && <span id={id}>{label}</span>}
    </span>
  );
}
