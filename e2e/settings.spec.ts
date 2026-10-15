/** Plan §4.2 scenarios 13, 14: backup export/import (replace, merge, malformed) and the web Reliability banner. */
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeAlarm, math, open, seed } from './helpers';

async function importText(page: Page, text: string) {
  await page.getByTestId('import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
}

test('13 · export, then import with replace, merge and malformed files', async ({ page }) => {
  await seed(page, { alarms: [makeAlarm({ hour: 6, minute: 30, label: 'One', missions: [math()] }), makeAlarm({ hour: 7, minute: 15, label: 'Two' })] });
  await open(page, '/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export alarms & settings' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^rouse-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const json = await readFile(await download.path(), 'utf8');
  const parsed = JSON.parse(json);
  expect(parsed.format).toBe('rouse-backup');
  expect(parsed.alarms).toHaveLength(2);
  await expect(page.getByTestId('toast')).toHaveText('Backup saved');

  // Malformed inputs change nothing.
  await importText(page, 'this is not json');
  await expect(page.getByTestId('import-error')).toHaveText("Couldn't read the file. Try exporting it again.");
  await importText(page, JSON.stringify({ hello: 'world' }));
  await expect(page.getByTestId('import-error')).toHaveText("This file isn't a Rouse backup.");
  await importText(page, JSON.stringify({ ...parsed, version: 99 }));
  await expect(page.getByTestId('import-error')).toHaveText('This backup is from a newer version of Rouse. Update the app, then try again.');

  // Replace: delete one alarm first, then restore both.
  await page.getByRole('link', { name: 'Alarms' }).click();
  await page.getByRole('button', { name: 'More options for 07:15 alarm' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('alarm-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Settings' }).click();
  await importText(page, json);
  const dialog = page.getByRole('dialog', { name: 'Restore this backup?' });
  await expect(dialog).toContainText('2 alarms, your settings');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(page).toHaveURL(/#\/alarms$/);
  await expect(page.getByTestId('toast')).toHaveText('Backup restored · 2 alarms');
  await expect(page.getByTestId('alarm-card')).toHaveCount(2);

  // Merge adds alarms (new ids) and keeps the current ones.
  await page.getByRole('link', { name: 'Settings' }).click();
  await importText(page, json);
  await page.getByRole('dialog', { name: 'Restore this backup?' }).getByRole('button', { name: 'Add to my alarms' }).click();
  await expect(page.getByTestId('alarm-card')).toHaveCount(4);
  const ids = await page.getByTestId('alarm-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-alarm-id')));
  expect(new Set(ids).size).toBe(4);
});

test('14 · Reliability on the web says it cannot wake a locked phone', async ({ page }) => {
  await seed(page, { alarms: [makeAlarm({ hour: 6, minute: 30 })] });
  await open(page);
  await expect(page.getByTestId('web-demo-banner')).toContainText("can't wake a locked phone");
  await page.getByRole('link', { name: "Reliability: web demo, can't wake a locked phone. Open reliability check" }).click();
  await expect(page).toHaveURL(/#\/health$/);
  await expect(page.getByRole('heading', { name: 'Reliability', level: 1 })).toBeFocused();
  await expect(page.getByTestId('health-summary')).toHaveText('Web demo: alarms only ring while this tab is open and the screen is on.');
  await expect(page.getByTestId('web-health-banner')).toContainText("This web demo can't wake a locked phone");
  await expect(page.getByRole('listitem', { name: /^Battery: Not in web demo\./ })).toBeVisible();
  await expect(page.getByRole('listitem', { name: /^Test alarm: Needs attention\. Never tested/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test alarm in 1 minute' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/alarms$/);

  // Theme switch is applied to <html data-theme>.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
