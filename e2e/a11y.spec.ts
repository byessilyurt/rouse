/** Plan §4.2 scenario 15: names, keyboard flow, target sizes, memory aria-pressed; plus onboarding. */
import { test, expect, type Page } from '@playwright/test';
import { makeAlarm, math, open, ringNow, seed } from './helpers';

/** Interactive elements without an accessible name (rough accname: aria-label/labelledby/text/label). */
async function unnamed(page: Page): Promise<string[]> {
  return page.locator('button, a[href], [role="switch"], [role="radio"], [role="spinbutton"], input:not([type="hidden"]), select, textarea').evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null && el.getAttribute('aria-hidden') !== 'true')
      .filter((el) => {
        const e = el as HTMLInputElement;
        const label = el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') ? 'x' : '') || el.textContent?.trim() || (e.labels && e.labels.length ? 'x' : '');
        return !label;
      })
      .map((el) => el.outerHTML.slice(0, 120)),
  );
}

/** Visible controls smaller than `min` px in either dimension. */
async function smallTargets(page: Page, min: number, selector = 'main button, main a[href], main [role="switch"], main select, nav a'): Promise<string[]> {
  return page.locator(selector).evaluateAll(
    (els, m) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.height < m - 0.5 || r.width < m - 0.5))
        .map(({ el, r }) => `${Math.round(r.width)}×${Math.round(r.height)} ${el.outerHTML.slice(0, 80)}`),
    min,
  );
}

test('15a · names and ≥48 px targets on list, editor and settings; keyboard flow', async ({ page }) => {
  await seed(page, { alarms: [makeAlarm({ hour: 6, minute: 30, label: 'Wake up', missions: [math()] })] });
  await open(page);
  expect(await unnamed(page)).toEqual([]);
  expect(await smallTargets(page, 48)).toEqual([]);

  // Keyboard: Tab to "New alarm", open it, focus lands on the H1, steppers work with the keyboard.
  let found = false;
  for (let i = 0; i < 30 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(() => document.activeElement?.textContent?.trim() === 'New alarm');
  }
  expect(found).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'New alarm', level: 1 })).toBeFocused();
  const hour = page.getByRole('spinbutton', { name: 'Hour' });
  await hour.focus();
  await page.keyboard.press('ArrowUp');
  await expect(hour).toHaveAttribute('aria-valuenow', '8');
  await page.getByRole('button', { name: 'Increase Hour' }).focus();
  await page.keyboard.press('Enter');
  await expect(hour).toHaveAttribute('aria-valuenow', '9');
  await page.getByRole('button', { name: 'Friday' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'false');
  expect(await unnamed(page)).toEqual([]);
  expect(await smallTargets(page, 48, 'main button:not(.btn-text), main [role="switch"], main select, main input')).toEqual([]);

  // Back with unsaved changes asks first; the safe choice is focused.
  await page.getByRole('button', { name: 'Back' }).click();
  const dlg = page.getByRole('dialog', { name: 'Discard changes?' });
  await expect(dlg.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);

  await open(page, '/settings');
  expect(await unnamed(page)).toEqual([]);
  expect(await smallTargets(page, 48, 'main button:not(.btn-text), main [role="switch"], main select, main [role="radio"], nav a')).toEqual([]);
});

test('15b · ring and mission targets are ≥64 px; memory tiles use aria-pressed and a symbol', async ({ page }) => {
  const alarm = makeAlarm({ missions: [{ type: 'memory', gridSize: 3, rounds: 1 }] });
  await seed(page, { alarms: [alarm] });
  await open(page);
  await ringNow(page, alarm.id);
  await expect(page.getByRole('button', { name: /Start mission/ })).toBeVisible();
  expect(await smallTargets(page, 64, 'main .ring-actions button')).toEqual([]);
  const primary = await page.getByRole('button', { name: /Start mission/ }).boundingBox();
  expect(primary!.height).toBeGreaterThanOrEqual(72);
  expect(await unnamed(page)).toEqual([]);

  await page.getByRole('button', { name: /Start mission/ }).click();
  await expect(page.getByRole('heading', { name: 'Remember these tiles' })).toBeVisible();
  const lit = await page.locator('[data-lit="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(', highlighted', '')));
  expect(lit.length).toBe(3);
  // Highlight is not colour-only: each lit tile has a star glyph.
  expect(await page.locator('[data-lit="true"] svg').count()).toBe(3);
  await expect(page.getByRole('heading', { name: 'Tap the tiles you saw' })).toBeVisible({ timeout: 6000 });
  expect(await smallTargets(page, 56, 'main .memory-tile')).toEqual([]);
  const first = page.getByRole('button', { name: lit[0], exact: true });
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  for (const name of lit.slice(1)) await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
});

test('15c · first-run onboarding creates an alarm; step text is real text', async ({ page }) => {
  await open(page, '/');
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rouse gets you out of bed.' })).toBeFocused();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await expect(page.getByRole('listitem', { name: /^Notifications: Not in web demo/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your first alarm' })).toBeVisible();
  await expect(page.getByText('Mission: Math · Easy · 3 problems')).toBeVisible();
  await page.getByRole('button', { name: 'Create alarm' }).click();
  await expect(page).toHaveURL(/#\/alarms$/);
  await expect(page.getByTestId('toast')).toContainText(/Alarm set for (07:00|7:00 AM), in /);
  await expect(page.getByTestId('alarm-card')).toHaveCount(1);
});
