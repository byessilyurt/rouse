/**
 * Inline SVG icons (design.md §6). Original simple paths; no icon font, no network.
 * Icons are decorative (aria-hidden) — the surrounding control supplies the accessible name.
 */
import type { ComponentChildren, JSX } from 'preact';
import type { MissionType } from '../core/types';

export type IconName =
  | 'plus' | 'check' | 'x' | 'chevron-left' | 'chevron-right' | 'chevron-up' | 'chevron-down' | 'more-vertical'
  | 'alarm-clock' | 'bar-chart' | 'sliders' | 'shield-check' | 'check-circle' | 'alert-triangle' | 'x-octagon'
  | 'help-circle' | 'info' | 'play' | 'square' | 'volume-2' | 'volume-x' | 'vibrate' | 'snooze' | 'sun' | 'moon'
  | 'bed' | 'flame' | 'math' | 'grid' | 'keyboard' | 'shake' | 'qr' | 'target' | 'footprints' | 'squat' | 'shuffle'
  | 'flashlight' | 'camera' | 'skip-forward' | 'download' | 'upload' | 'external-link' | 'trash' | 'arrow-up'
  | 'arrow-down' | 'star' | 'minus' | 'delete' | 'circle' | 'triangle' | 'diamond';

const paths: Record<IconName, ComponentChildren> = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="M5 12l5 5L20 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'more-vertical': (
    <>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  'alarm-clock': (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2M5 3L2 6M19 3l3 3" />
    </>
  ),
  'bar-chart': <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  sliders: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  'shield-check': <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.5 12l2.5 2.5 4.5-5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  'alert-triangle': <path d="M12 3L2 21h20L12 3zM12 10v4M12 17.5v.01" />,
  'x-octagon': <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8zM9 9l6 6M15 9l-6 6" />,
  'help-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  play: <path d="M7 4l13 8-13 8z" />,
  square: <rect x="6" y="6" width="12" height="12" rx="1" />,
  'volume-2': <path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />,
  'volume-x': <path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6" />,
  vibrate: (
    <>
      <rect x="8" y="4" width="8" height="16" rx="2" />
      <path d="M4 9v6M20 9v6" />
    </>
  ),
  snooze: <path d="M4 8h6l-6 8h6M13 4h7l-7 9h7" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z" />,
  bed: (
    <>
      <path d="M3 18v-8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
      <circle cx="7" cy="11" r="1.5" />
    </>
  ),
  flame: <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 1.5.8 2.5 2 3 0-3 0-5.5 1-8.5z" />,
  math: <path d="M5 7h6M8 4v6M14 7h6M5 17h6M14 15h6M14 19h6" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 15h10" />
    </>
  ),
  shake: (
    <>
      <rect x="7" y="4" width="10" height="16" rx="2" />
      <path d="M3 8l-1 4 1 4M21 8l1 4-1 4" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="6" height="6" />
      <rect x="15" y="3" width="6" height="6" />
      <rect x="3" y="15" width="6" height="6" />
      <path d="M15 15h2v2h-2zM19 19h2v2h-2zM19 15h2M15 19v2" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" />
    </>
  ),
  footprints: (
    <>
      <ellipse cx="8" cy="8" rx="2.5" ry="4" />
      <ellipse cx="16" cy="15" rx="2.5" ry="4" />
    </>
  ),
  squat: (
    <>
      <circle cx="12" cy="4" r="1.5" />
      <path d="M12 7v5l-4 4v4M12 12l4 4v4M8 9h8" />
    </>
  ),
  shuffle: <path d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l3 3-3 3M18 14l3 3-3 3" />,
  flashlight: <path d="M8 3h8v4l-2 3v11h-4V10L8 7zM12 13v2" />,
  camera: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7l2-3h4l2 3" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  'skip-forward': <path d="M5 5l10 7-10 7zM19 5v14" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  'external-link': <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  'arrow-up': <path d="M12 19V5M5 12l7-7 7 7" />,
  'arrow-down': <path d="M12 5v14M5 12l7 7 7-7" />,
  delete: <path d="M9 5h11v14H9l-6-7zM12 9l5 6M17 9l-5 6" />,
  star: <path fill="currentColor" d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />,
  circle: <circle cx="12" cy="12" r="7" fill="currentColor" />,
  triangle: <path fill="currentColor" d="M12 4l9 16H3z" />,
  diamond: <path fill="currentColor" d="M12 3l9 9-9 9-9-9z" />,
};

export interface IconProps {
  name: IconName;
  size?: number;
  class?: string;
  title?: string;
  style?: JSX.CSSProperties | string;
}

export function Icon({ name, size = 24, class: cls, style }: IconProps) {
  return (
    <svg
      class={cls ? `icon ${cls}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}

export const MISSION_ICON: Record<MissionType | 'random', IconName> = {
  math: 'math',
  memory: 'grid',
  typing: 'keyboard',
  shake: 'shake',
  qr: 'qr',
  tap: 'target',
  steps: 'footprints',
  squat: 'squat',
  random: 'shuffle',
};
