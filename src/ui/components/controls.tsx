/**
 * Form controls (design.md §5): Toggle, Segmented, Stepper, TimePicker, DayChips, Keypad, Select, TextField.
 */
import type { ComponentChildren, InputHTMLAttributes } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { Weekday } from '../../core/types';
import { Icon } from '../icons';
import { weekOrder, weekdayName } from '../format';
import { Button } from './Button';

// ── Toggle ────────────────────────────────────────────────────────────────
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Visible label (defaults to `label`); pass null to hide it visually (aria-label still set). */
  visibleLabel?: ComponentChildren | null;
  description?: ComponentChildren;
  showStateText?: boolean;
  compact?: boolean;
  id?: string;
  class?: string;
}

export function Toggle({ checked, onChange, label, visibleLabel, description, showStateText = true, compact, id, class: cls }: ToggleProps) {
  const descId = useId();
  const showLabel = visibleLabel !== null;
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      aria-describedby={description ? descId : undefined}
      class={`toggle${compact ? ' compact' : ''}${cls ? ` ${cls}` : ''}`}
      onClick={() => onChange(!checked)}
    >
      {showLabel && (
        <span class="toggle-text">
          <span class="list-row-title">{visibleLabel ?? label}</span>
          {description && (
            <span class="list-row-desc" id={descId}>
              {description}
            </span>
          )}
        </span>
      )}
      <span class="toggle-col">
        <span class="toggle-track" aria-hidden="true">
          <span class="toggle-thumb">{checked && <Icon name="check" size={14} />}</span>
        </span>
        {showStateText && (
          <span class="toggle-state" aria-hidden="true">
            {checked ? 'On' : 'Off'}
          </span>
        )}
      </span>
    </button>
  );
}

// ── Segmented ─────────────────────────────────────────────────────────────
export interface SegmentedOption<T> {
  value: T;
  label: string;
}
export interface SegmentedProps<T> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  fill?: boolean;
  class?: string;
  labelledBy?: string;
}

export function Segmented<T extends string | number>({ options, value, onChange, label, fill, class: cls, labelledBy }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const move = (to: number) => {
    const n = (to + options.length) % options.length;
    const opt = options[n];
    if (!opt) return;
    onChange(opt.value);
    refs.current[n]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      class={`segmented${fill ? ' fill' : ''}${cls ? ` ${cls}` : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(idx + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(idx - 1);
        }
      }}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected ? 'true' : 'false'}
            tabIndex={i === idx ? 0 : -1}
            onClick={() => onChange(o.value)}
          >
            {selected && <Icon name="check" size={16} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Stepper ───────────────────────────────────────────────────────────────
export interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  wrap?: boolean;
  format?: (v: number) => string;
  valueText?: (v: number) => string;
  size?: 'md' | 'ring';
  editable?: boolean;
  onChange: (v: number) => void;
  /** Visible label above the control (default true). */
  showLabel?: boolean;
  /** After holding for 2 s, jump by this much instead (minutes → 5). */
  holdStep?: number;
  /** Error text for an invalid typed value, e.g. "Enter 0–23". */
  editHelper?: string;
  id?: string;
  describedBy?: string;
}

export function stepValue(value: number, delta: number, min: number, max: number, wrap: boolean): number {
  const next = value + delta;
  if (wrap) {
    const span = max - min + 1;
    return ((((next - min) % span) + span) % span) + min;
  }
  return Math.min(max, Math.max(min, next));
}

export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  wrap = false,
  format = String,
  valueText,
  size = 'md',
  editable = false,
  onChange,
  showLabel = true,
  holdStep,
  editHelper,
  id,
  describedBy,
}: StepperProps) {
  const labelId = useId();
  const errId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const hold = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval>; started: number } | null>(null);

  const atMin = !wrap && value <= min;
  const atMax = !wrap && value >= max;

  const apply = (delta: number) => {
    const next = stepValue(valueRef.current, delta, min, max, wrap);
    if (next !== valueRef.current) {
      valueRef.current = next;
      onChange(next);
    }
  };
  const stopHold = () => {
    if (hold.current) {
      clearTimeout(hold.current.t);
      clearInterval(hold.current.i);
      hold.current = null;
    }
  };
  useEffect(() => stopHold, []);
  const startHold = (dir: 1 | -1) => {
    stopHold();
    apply(dir * step);
    const h: { t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval>; started: number } = { started: Date.now() };
    hold.current = h;
    h.t = setTimeout(() => {
      h.i = setInterval(() => {
        const big = holdStep && Date.now() - h.started >= 2000;
        if (big) {
          // Jump to the next multiple of holdStep in the direction of travel.
          const cur = valueRef.current;
          const target = dir > 0 ? Math.floor(cur / holdStep) * holdStep + holdStep : Math.ceil(cur / holdStep) * holdStep - holdStep;
          apply(target - cur);
        } else {
          apply(dir * step);
        }
      }, 125);
    }, 400);
  };

  const btn = (dir: 1 | -1) => {
    const disabled = dir < 0 ? atMin : atMax;
    return (
      <button
        type="button"
        class="stepper-btn"
        aria-label={`${dir < 0 ? 'Decrease' : 'Increase'} ${label}`}
        aria-disabled={disabled ? 'true' : undefined}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.preventDefault();
          startHold(dir);
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onClick={(e) => {
          // Pointer clicks were handled on pointerdown; keyboard activation has detail 0.
          if (disabled || e.detail > 0) return;
          apply(dir * step);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Icon name={dir < 0 ? 'minus' : 'plus'} size={size === 'ring' ? 32 : 24} />
      </button>
    );
  };

  const commit = () => {
    const text = draft.trim();
    const n = Number(text);
    setEditing(false);
    if (text === '' || !Number.isInteger(n) || n < min || n > max) {
      setError(editHelper ?? `Enter ${min}–${max}`);
      return;
    }
    setError(null);
    if (n !== value) onChange(n);
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const describe = [describedBy, error ? errId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div class={`stepper${size === 'ring' ? ' ring' : ''}`}>
      {showLabel && (
        <span class="field-label" id={labelId}>
          {label}
        </span>
      )}
      <div class="stepper-row">
        {btn(-1)}
        {editing ? (
          <input
            ref={inputRef}
            class="stepper-input"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            aria-label={label}
            value={draft}
            onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 2))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
            onBlur={commit}
          />
        ) : (
          <div
            id={id}
            class="stepper-value"
            role="spinbutton"
            tabIndex={0}
            aria-label={label}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={valueText ? valueText(value) : format(value)}
            aria-describedby={describe}
            onClick={() => {
              if (!editable) return;
              setDraft(format(value));
              setError(null);
              setEditing(true);
            }}
            onKeyDown={(e) => {
              const k = e.key;
              let handled = true;
              if (k === 'ArrowUp' || k === 'ArrowRight') apply(step);
              else if (k === 'ArrowDown' || k === 'ArrowLeft') apply(-step);
              else if (k === 'PageUp') apply(step * 5);
              else if (k === 'PageDown') apply(-step * 5);
              else if (k === 'Home') onChange(min);
              else if (k === 'End') onChange(max);
              else if (editable && (k === 'Enter' || /^[0-9]$/.test(k))) {
                setDraft(/^[0-9]$/.test(k) ? k : format(value));
                setError(null);
                setEditing(true);
              } else handled = false;
              if (handled) e.preventDefault();
            }}
          >
            {format(value)}
          </div>
        )}
        {btn(1)}
      </div>
      {error && (
        <p class="error-text" id={errId}>
          <Icon name="alert-triangle" size={18} />
          {error}
        </p>
      )}
    </div>
  );
}

// ── TimePicker ────────────────────────────────────────────────────────────
export interface TimePickerProps {
  hour: number;
  minute: number;
  use24h: boolean;
  onChange: (hour: number, minute: number) => void;
}

export function TimePicker({ hour, minute, use24h, onChange }: TimePickerProps) {
  const pm = hour >= 12;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div class="timepicker" role="group" aria-label="Alarm time">
      <div class="timepicker-row">
        {use24h ? (
          <Stepper
            label="Hour"
            showLabel={false}
            value={hour}
            min={0}
            max={23}
            wrap
            size="ring"
            editable
            format={pad}
            valueText={(v) => `${v} hours`}
            editHelper="Enter 0–23"
            onChange={(v) => onChange(v, minute)}
          />
        ) : (
          <Stepper
            label="Hour"
            showLabel={false}
            value={h12}
            min={1}
            max={12}
            wrap
            size="ring"
            editable
            format={String}
            valueText={(v) => `${v} ${pm ? 'PM' : 'AM'}`}
            editHelper="Enter 1–12"
            onChange={(v) => onChange((v % 12) + (pm ? 12 : 0), minute)}
          />
        )}
        <span class="colon" aria-hidden="true">
          :
        </span>
        <Stepper
          label="Minute"
          showLabel={false}
          value={minute}
          min={0}
          max={59}
          wrap
          size="ring"
          editable
          holdStep={5}
          format={pad}
          valueText={(v) => `${v} minutes`}
          editHelper="Enter 0–59"
          onChange={(v) => onChange(hour, v)}
        />
      </div>
      {!use24h && (
        <Segmented
          class="ampm"
          label="AM or PM"
          options={[
            { value: 'am', label: 'AM' },
            { value: 'pm', label: 'PM' },
          ]}
          value={pm ? 'pm' : 'am'}
          onChange={(v) => onChange((hour % 12) + (v === 'pm' ? 12 : 0), minute)}
        />
      )}
    </div>
  );
}

// ── DayChips ──────────────────────────────────────────────────────────────
export interface DayChipsProps {
  value: readonly Weekday[];
  weekStart: 0 | 1;
  onChange: (days: Weekday[]) => void;
}

export function DayChips({ value, weekStart, onChange }: DayChipsProps) {
  const set = new Set(value);
  return (
    <div class="daychips" role="group" aria-label="Repeat on">
      {weekOrder(weekStart).map((d) => {
        const on = set.has(d);
        return (
          <button
            key={d}
            type="button"
            class="daychip"
            aria-pressed={on ? 'true' : 'false'}
            aria-label={weekdayName(d, 'long')}
            onClick={() => {
              const next = new Set(set);
              if (on) next.delete(d);
              else next.add(d);
              onChange([...next].sort((a, b) => a - b));
            }}
          >
            <span aria-hidden="true">{weekdayName(d, 'narrow')}</span>
            {on && (
              <span class="badge-check" aria-hidden="true">
                <Icon name="check" size={12} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Keypad ────────────────────────────────────────────────────────────────
export interface KeypadProps {
  onDigit: (d: string) => void;
  onDelete: () => void;
  onEnter: () => void;
}

export function Keypad({ onDigit, onDelete, onEnter }: KeypadProps) {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div class="keypad" role="group" aria-label="Number pad">
      {digits.map((d) => (
        <Button key={d} variant="secondary" size="ring" onClick={() => onDigit(d)}>
          {d}
        </Button>
      ))}
      <Button variant="secondary" size="ring" aria-label="Delete digit" onClick={onDelete}>
        <span aria-hidden="true">⌫</span>
      </Button>
      <Button variant="secondary" size="ring" onClick={() => onDigit('0')}>
        0
      </Button>
      <Button variant="primary" size="ring" aria-label="Check answer" onClick={onEnter}>
        <span aria-hidden="true">✓</span>
      </Button>
    </div>
  );
}

// ── Select & TextField ────────────────────────────────────────────────────
export interface SelectProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (v: T) => void;
  helper?: ComponentChildren;
}

export function Select<T extends string | number>({ label, value, options, onChange, helper }: SelectProps<T>) {
  const id = useId();
  const helpId = useId();
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <select
        id={id}
        class="select"
        value={String(value)}
        aria-describedby={helper ? helpId : undefined}
        onChange={(e) => {
          const raw = (e.currentTarget as HTMLSelectElement).value;
          const opt = options.find((o) => String(o.value) === raw);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      {helper && (
        <p class="muted small" id={helpId}>
          {helper}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type' | 'role'> {
  label: string;
  value: string;
  onValue: (v: string) => void;
  error?: string | null;
  helper?: ComponentChildren;
  hideLabel?: boolean;
}

export function TextField({ label, value, onValue, error, helper, hideLabel, ...rest }: TextFieldProps) {
  const id = useId();
  const errId = useId();
  const helpId = useId();
  const describedBy = [error ? errId : null, helper ? helpId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div class="field">
      <label for={id} class={hideLabel ? 'visually-hidden' : undefined}>
        {label}
      </label>
      <input
        {...rest}
        id={id}
        class="input"
        value={value}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        onInput={(e) => onValue((e.currentTarget as HTMLInputElement).value)}
      />
      {helper && (
        <p class="muted small" id={helpId}>
          {helper}
        </p>
      )}
      {error && (
        <p class="error-text" id={errId}>
          <Icon name="alert-triangle" size={18} />
          {error}
        </p>
      )}
    </div>
  );
}
