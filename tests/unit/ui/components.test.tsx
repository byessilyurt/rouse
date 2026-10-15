import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { DayChips, Segmented, Stepper, Toggle, stepValue } from '../../../src/ui/components/controls';
import { Button } from '../../../src/ui/components/Button';
import { CheckRow, IdleMeter, ProgressRing } from '../../../src/ui/components/layout';
import { Dialog } from '../../../src/ui/components/overlays';
import type { Weekday } from '../../../src/core/types';
import { click, input, key, mount, type Rendered } from './render';

let r: Rendered | null = null;
afterEach(() => {
  r?.unmount();
  r = null;
});

function StepperHarness(props: { wrap?: boolean; editable?: boolean; min?: number; max?: number; start?: number }) {
  const [v, setV] = useState(props.start ?? 5);
  return <Stepper label="Snooze length" value={v} min={props.min ?? 1} max={props.max ?? 10} wrap={props.wrap} editable={props.editable} valueText={(x) => `${x} minutes`} onChange={setV} />;
}

describe('Stepper', () => {
  it('wraps or clamps', () => {
    expect(stepValue(59, 1, 0, 59, true)).toBe(0);
    expect(stepValue(0, -1, 0, 59, true)).toBe(59);
    expect(stepValue(57, 5, 0, 59, true)).toBe(2);
    expect(stepValue(10, 1, 1, 10, false)).toBe(10);
  });

  it('is a spinbutton with valuetext and keyboard support', async () => {
    r = await mount(<StepperHarness />);
    const spin = r.byRole('spinbutton', 'Snooze length');
    expect(spin.getAttribute('aria-valuenow')).toBe('5');
    expect(spin.getAttribute('aria-valuetext')).toBe('5 minutes');
    await key(spin, 'ArrowUp');
    expect(spin.getAttribute('aria-valuenow')).toBe('6');
    await key(spin, 'End');
    expect(spin.getAttribute('aria-valuenow')).toBe('10');
    // At the bound without wrap the + button is aria-disabled (still focusable) and does nothing.
    const plus = r.byRole('button', 'Increase Snooze length');
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    await click(plus);
    expect(spin.getAttribute('aria-valuenow')).toBe('10');
    await click(r.byRole('button', 'Decrease Snooze length'));
    expect(r.byRole('spinbutton').getAttribute('aria-valuenow')).toBe('9');
  });

  it('accepts typed values and reverts invalid ones with a helper', async () => {
    r = await mount(<StepperHarness editable min={0} max={23} start={7} />);
    await click(r.byRole('spinbutton'));
    const field = r.container.querySelector('input')!;
    expect(field.getAttribute('inputmode')).toBe('numeric');
    await input(field, '99');
    await key(field, 'Enter');
    expect(r.byRole('spinbutton').getAttribute('aria-valuenow')).toBe('7');
    expect(r.text()).toContain('Enter 0–23');
    await click(r.byRole('spinbutton'));
    const again = r.container.querySelector('input')!;
    await input(again, '6');
    await key(again, 'Enter');
    expect(r.byRole('spinbutton').getAttribute('aria-valuenow')).toBe('6');
    expect(r.text()).not.toContain('Enter 0–23');
  });

  it('repeats while held (400 ms delay, 8 steps/s)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      r = await mount(<StepperHarness max={30} start={1} />);
      const plus = r.byRole('button', 'Increase Snooze length');
      plus.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      await vi.advanceTimersByTimeAsync(400 + 125 * 4);
      plus.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(1000);
      expect(Number(r.byRole('spinbutton').getAttribute('aria-valuenow'))).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Toggle, Segmented, DayChips', () => {
  it('Toggle is a switch with visible On/Off text', async () => {
    const onChange = vi.fn();
    r = await mount(<Toggle checked={false} onChange={onChange} label="Vibrate" />);
    const sw = r.byRole('switch', 'Vibrate');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.textContent).toContain('Off');
    await click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Segmented is a radiogroup with roving tabindex and arrow keys', async () => {
    function H() {
      const [v, setV] = useState('dark');
      return (
        <Segmented
          label="Theme"
          value={v}
          onChange={setV}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      );
    }
    r = await mount(<H />);
    const group = r.byRole('radiogroup', 'Theme');
    const [dark, light] = r.allByRole('radio');
    expect(dark!.getAttribute('aria-checked')).toBe('true');
    expect(dark!.tabIndex).toBe(0);
    expect(light!.tabIndex).toBe(-1);
    await key(group, 'ArrowRight');
    expect(r.allByRole('radio')[1]!.getAttribute('aria-checked')).toBe('true');
  });

  it('DayChips use full day names and aria-pressed with a check badge', async () => {
    function H() {
      const [d, setD] = useState<Weekday[]>([1, 2, 3, 4, 5]);
      return <DayChips value={d} weekStart={1} onChange={setD} />;
    }
    r = await mount(<H />);
    expect(r.byRole('group', 'Repeat on')).toBeTruthy();
    const chips = r.allByRole('button');
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(r.byRole('button', 'Monday').getAttribute('aria-pressed')).toBe('true');
    expect(r.byRole('button', 'Monday').querySelector('.badge-check')).not.toBeNull();
    await click(r.byRole('button', 'Sunday'));
    expect(r.byRole('button', 'Sunday').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('display components', () => {
  it('Button with ariaDisabled stays focusable and ignores clicks', async () => {
    const onClick = vi.fn();
    r = await mount(
      <Button ariaDisabled onClick={onClick}>
        Add mission
      </Button>,
    );
    const b = r.byRole('button', 'Add mission');
    expect(b.hasAttribute('disabled')).toBe(false);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    await click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('CheckRow speaks "{Title}: {status word}. {explanation}"', async () => {
    r = await mount(
      <ul>
        <CheckRow status="warn" title="Battery" detail="Optimised: Android may stop Rouse overnight." fix={{ label: 'Fix', onClick: () => undefined }} />
      </ul>,
    );
    expect(r.byRole('listitem').getAttribute('aria-label')).toBe('Battery: Needs attention. Optimised: Android may stop Rouse overnight.');
    expect(r.byRole('button', 'Fix')).toBeTruthy();
  });

  it('IdleMeter changes words by state, not only colour', async () => {
    r = await mount(<IdleMeter remainingMs={25_000} state="quiet" />);
    expect(r.text()).toContain('Sound off while you work');
    await r.rerender(<IdleMeter remainingMs={8_200} state="warning" />);
    expect(r.text()).toContain('Alarm returns in 9 s');
    await r.rerender(<IdleMeter remainingMs={0} state="ringing" />);
    expect(r.text()).toContain('Alarm is back. Keep going to turn it off.');
  });

  it('ProgressRing exposes progressbar values or a timer role', async () => {
    r = await mount(<ProgressRing value={3} max={10} label="Steps" valueText="3 of 10 steps" center={<span>3</span>} />);
    const bar = r.byRole('progressbar', 'Steps');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuetext')).toBe('3 of 10 steps');
    await r.rerender(<ProgressRing mode="timer" value={60} max={90} label="Time to answer" center={<span>1:00</span>} />);
    expect(r.byRole('timer', 'Time to answer')).toBeTruthy();
  });

  it('Dialog focuses the safe action first', async () => {
    r = await mount(
      <Dialog
        open
        destructive
        title="Delete this alarm?"
        actions={[
          { label: 'Keep', variant: 'primary', autofocus: true, onClick: () => undefined },
          { label: 'Delete', variant: 'danger', onClick: () => undefined },
        ]}
      />,
    );
    await new Promise((res) => setTimeout(res, 0));
    expect(r.byRole('alertdialog', 'Delete this alarm?')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Keep');
  });
});
