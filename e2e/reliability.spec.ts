/** Gap-fill: cancelling a pending test alarm (Reliability + editor) and "Copy diagnostics". */
import { test, expect, type Page } from '@playwright/test';
import { inspect, installClock, makeAlarm, open, seed } from './helpers';

const testTimers = async (page: Page) => (await inspect(page)).timers.filter((t) => t.kind === 'test');

test('G1 · a pending test alarm can be cancelled from Reliability and never rings', async ({ page }) => {
  await seed(page, { alarms: [makeAlarm({ hour: 6, minute: 30, label: 'Gym' })] });
  await installClock(page);
  await open(page, '/health');
  const start = page.getByRole('button', { name: 'Test alarm in 1 minute' });
  await expect(start).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel test' })).toHaveCount(0);

  await start.click();
  await expect(page.getByRole('button', { name: /^Test alarm in [01]:\d\d$/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Cancel test' })).toBeVisible();
  expect(await testTimers(page)).toHaveLength(1);

  await page.getByRole('button', { name: 'Cancel test' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Test cancelled');
  await expect(page.getByRole('button', { name: 'Test alarm in 1 minute' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel test' })).toHaveCount(0);
  expect(await testTimers(page)).toHaveLength(0);

  // Past the original fire time: nothing rings, and Reliability does not blame the phone ("didn't ring").
  await page.clock.fastForward(5 * 60_000);
  await expect.poll(async () => (await inspect(page)).ring).toBeNull();
  await expect(page).toHaveURL(/#\/health$/);
  await expect(page.getByRole('listitem', { name: /^Test alarm: Needs attention\. Never tested/ })).toBeVisible();
  expect((await inspect(page)).log).toEqual([]);
});

test('G2 · the alarm editor shows a pending test and can cancel it too', async ({ page }) => {
  const alarm = makeAlarm({ hour: 6, minute: 30, label: 'Gym' });
  await seed(page, { alarms: [alarm] });
  await installClock(page);
  await open(page, '/health');
  await page.getByRole('button', { name: 'Test alarm in 1 minute' }).click();
  await expect(page.getByRole('button', { name: 'Cancel test' })).toBeVisible();

  await page.evaluate((id) => {
    location.hash = `/alarm/${id}`;
  }, alarm.id);
  await expect(page.getByRole('heading', { name: 'Edit alarm' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test this alarm' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Test alarm in [01]:\d\d$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel test' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Test cancelled');
  await expect(page.getByRole('button', { name: 'Test this alarm' })).toBeVisible();
  expect(await testTimers(page)).toHaveLength(0);

  // The editor's own test flow still works after a cancel.
  await page.getByRole('button', { name: 'Test this alarm' }).click();
  await expect(page.getByText("Test alarm · won't count in stats")).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'End test' }).click();
  expect((await inspect(page)).ring).toBeNull();
});

test('G3 · Copy diagnostics puts a label-free summary on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seed(page, { alarms: [makeAlarm({ hour: 6, minute: 30, label: 'Dentist with Dr Private' })] });
  await open(page, '/health');
  await page.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Diagnostics copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Rouse \S+\nRouse diagnostics · web · /);
  expect(text).toContain('[health]');
  expect(text).toContain('lockedDevice: unsupported (critical)');
  expect(text).toContain('[scheduled]');
  expect(text).toContain('alarms mirrored: 1');
  expect(text).not.toContain('Dentist');
  await expect(page.getByTestId('diagnostics-text')).toHaveCount(0);
});

test('G4 · Copy diagnostics falls back to selectable text when the clipboard is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    document.execCommand = () => false;
  });
  await seed(page, { alarms: [makeAlarm({ hour: 6, minute: 30 })] });
  await open(page, '/health');
  await page.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Select the text below and copy it');
  const box = page.getByRole('textbox', { name: 'Diagnostics' });
  await expect(box).toBeVisible();
  await expect(box).toHaveValue(/Rouse diagnostics · web/);
  await expect(box).toBeFocused();
});
