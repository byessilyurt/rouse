import { test, expect } from '@playwright/test';
import { open, seed, makeAlarm, math } from './helpers';

test('app boots to onboarding on first run', async ({ page }) => {
  await open(page, '/');
  await expect(page).toHaveURL(/#\/onboarding\/1/);
  await expect(page.getByRole('heading', { name: 'Rouse gets you out of bed.' })).toBeVisible();
  await expect(page.getByTestId('web-demo-banner')).toBeVisible();
});

test('alarm list shows seeded alarm', async ({ page }) => {
  await seed(page, { alarms: [makeAlarm({ hour: 6, minute: 30, label: 'Wake up', missions: [math()] })] });
  await open(page);
  await expect(page.getByRole('heading', { name: 'Alarms', level: 1 })).toBeVisible();
  await expect(page.getByTestId('alarm-card')).toHaveCount(1);
  await expect(page.getByTestId('alarm-card')).toContainText('06:30');
});
