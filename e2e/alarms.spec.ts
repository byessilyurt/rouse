/** Plan §4.2 scenarios 1, 2, 11: CRUD, validation, one-off & nap consumption. */
import { test, expect } from '@playwright/test';
import { installClock, makeAlarm, open, seed, T0 } from './helpers';

test('1 · create, countdown, toggle, skip next, edit, delete', async ({ page }) => {
  await installClock(page, T0);
  await seed(page);
  await open(page);
  await expect(page.getByRole('heading', { name: 'No alarms yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Create your first alarm' }).click();
  await expect(page).toHaveURL(/#\/alarm\/new$/);
  await expect(page.getByRole('heading', { name: 'New alarm', level: 1 })).toBeFocused();

  // Type the hour, step the minute.
  await page.getByRole('spinbutton', { name: 'Hour' }).click();
  await page.getByRole('textbox', { name: 'Hour' }).fill('7');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'Hour' })).toHaveAttribute('aria-valuenow', '7');
  await page.getByRole('spinbutton', { name: 'Minute' }).click();
  await page.getByRole('textbox', { name: 'Minute' }).fill('30');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Weekdays', exact: true }).click();
  await page.getByRole('textbox', { name: 'Label' }).fill('Wake up');
  await expect(page.getByTestId('rings-in')).toHaveText('Rings in 1 h 30 m');
  await page.getByRole('button', { name: 'Save alarm' }).click();

  await expect(page).toHaveURL(/#\/alarms$/);
  await expect(page.getByTestId('toast')).toHaveText('Alarm set for in 1 h 30 m');
  const hero = page.getByTestId('next-alarm');
  await expect(hero).toContainText('in 1 h 30 m');
  await expect(hero).toContainText('Thu 07:30 · Wake up');
  await expect(hero).toHaveAttribute('aria-label', 'Next alarm in 1 hour 30 minutes, Thursday 7:30, Wake up');
  const card = page.getByTestId('alarm-card');
  await expect(card).toContainText('07:30');
  await expect(card).toContainText('Weekdays');
  await expect(card.getByRole('img', { name: 'Missions: Math' })).toBeVisible();

  // Countdown refreshes as time passes.
  await page.clock.fastForward('30:00');
  await expect(hero).toContainText('in 1 h', { timeout: 35_000 });
  await expect(hero).not.toContainText('30 m');

  // Toggle off / on.
  const toggle = page.getByRole('switch', { name: 'Alarm 07:30, Wake up, Weekdays' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('toast')).toHaveText('Alarm off');
  await expect(hero).toContainText('No alarms on');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('toast')).toHaveText(/Alarm set for in 1 h/);

  // Skip next.
  await page.getByRole('button', { name: 'More options for 07:30 alarm' }).click();
  await page.getByRole('button', { name: 'Skip next (Thu 07:30)' }).click();
  await expect(card).toContainText('Skipping Thu');
  await expect(hero).toContainText('Fri 07:30');
  await page.getByRole('button', { name: 'More options for 07:30 alarm' }).click();
  await page.getByRole('button', { name: "Don't skip" }).click();
  await expect(hero).toContainText('Thu 07:30');

  // Edit.
  await card.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Edit alarm' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Label' }).fill('Gym');
  await page.getByRole('button', { name: 'Save alarm' }).click();
  await expect(card).toContainText('Gym');

  // Delete (safe choice first).
  await page.getByRole('button', { name: 'More options for 07:30 alarm' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this alarm?' });
  await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Alarm deleted');
  await expect(page.getByRole('heading', { name: 'No alarms yet' })).toBeVisible();
});

test('2 · validation: unregistered QR blocks Save; a 4th mission is disabled', async ({ page }) => {
  await seed(page);
  await open(page);
  await page.getByRole('button', { name: 'Create your first alarm' }).click();
  await expect(page.getByText('1 of 3')).toBeVisible();

  await page.getByRole('button', { name: 'Add mission' }).click();
  await page.getByTestId('tile-qr').click();
  await expect(page.getByRole('heading', { name: 'QR / barcode' })).toBeVisible();
  await expect(page.getByTestId('qr-status')).toHaveText('No code yet');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Code not set')).toBeVisible();

  await page.getByRole('button', { name: 'Save alarm' }).click();
  await expect(page.getByText('Scan a code for the QR mission, or remove it.')).toBeVisible();
  await expect(page).toHaveURL(/#\/alarm\/new$/);
  await expect(page.getByRole('button', { name: /2: QR \/ barcode/ })).toBeFocused();

  await page.getByRole('button', { name: 'Add mission' }).click();
  await page.getByTestId('tile-typing').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('3 of 3')).toBeVisible();
  const add = page.getByRole('button', { name: 'Add mission' });
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Up to 3 missions.')).toBeVisible();
  await add.dispatchEvent('click');
  await expect(page).toHaveURL(/#\/alarm\/new$/);

  // Reorder and remove.
  await page.getByRole('button', { name: 'Move Typing up' }).click();
  await expect(page.getByTestId('mission-row').nth(1)).toContainText('Typing');
  await page.getByRole('button', { name: 'Remove QR / barcode' }).click();
  await expect(page.getByText('2 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Save alarm' }).click();
  await expect(page).toHaveURL(/#\/alarms$/);
  await expect(page.getByTestId('alarm-card').getByRole('img', { name: 'Missions: Math, then Typing' })).toBeVisible();
});

test('11 · a one-off alarm is turned off after ringing; a nap is deleted', async ({ page }) => {
  await installClock(page, T0);
  const once = makeAlarm({ hour: 6, minute: 30, days: [], label: 'Dentist' });
  await seed(page, { alarms: [once] });
  await open(page);
  await expect(page.getByTestId('alarm-card')).toContainText('Once · today');
  await expect(page.getByTestId('next-alarm')).toContainText('in 30 m');

  await page.clock.fastForward('30:05');
  await expect(page).toHaveURL(/#\/ring/, { timeout: 35_000 });
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('switch', { name: /Alarm 06:30, Dentist/ })).toHaveAttribute('aria-checked', 'false');

  // Quick nap (no mission) → rings → deleted.
  await page.getByRole('button', { name: 'Quick nap' }).click();
  const sheet = page.getByRole('dialog', { name: 'Quick nap' });
  await sheet.getByRole('radio', { name: '10 min' }).click();
  await sheet.getByRole('button', { name: /Start nap · rings at \d\d:\d\d/ }).click();
  await expect(page.getByTestId('alarm-card').filter({ hasText: 'Nap' })).toHaveCount(1);
  await page.clock.fastForward('11:00');
  await expect(page).toHaveURL(/#\/ring/, { timeout: 35_000 });
  await expect(page.getByText('Nap', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Turn off' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('alarm-card').filter({ hasText: 'Nap' })).toHaveCount(0);
  const log = await page.evaluate(() => window.__rouseTest!.inspect().log.map((e) => e.type));
  expect(log.filter((t) => t === 'one-off-consumed')).toHaveLength(2);
});

test('editor: "Try it now" practice and "Test this alarm" with "End test"', async ({ page }) => {
  await seed(page);
  await open(page);
  await page.getByRole('button', { name: 'Create your first alarm' }).click();
  await page.getByRole('button', { name: /^1: Math/ }).click();
  await page.getByRole('radio', { name: 'Very easy' }).click();
  await page.getByRole('button', { name: 'Decrease Problems' }).click();
  await page.getByRole('button', { name: 'Decrease Problems' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Problems' })).toHaveAttribute('aria-valuenow', '1');
  await page.getByRole('button', { name: 'Try it now' }).click();
  await expect(page.getByText('Practice', { exact: true })).toBeVisible();
  await expect(page.getByTestId('idle-meter')).toHaveCount(0);
  const { solveMath } = await import('./helpers');
  await solveMath(page, 1);
  await page.getByRole('button', { name: 'Back to mission' }).click();
  await expect(page.getByRole('heading', { name: 'Math', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /^1: Math, Very easy · 1 problem/ })).toBeVisible();

  await page.getByRole('button', { name: 'Test this alarm' }).click();
  await expect(page.getByText("Test alarm · won't count in stats")).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'End test' }).click();
  await expect(page).toHaveURL(/#\/alarm\/new$/);
  await expect(page.getByRole('heading', { name: 'New alarm' })).toBeVisible();
  expect(await page.evaluate(() => window.__rouseTest!.inspect().log)).toEqual([]);
});
