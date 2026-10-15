import { test, expect } from '@playwright/test';
import { installClock, makeAlarm, open, seed, T0, ringNow } from './helpers';
test('dbg', async ({ page }) => {
  page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await installClock(page, T0);
  const once = makeAlarm({ hour: 6, minute: 30, days: [], label: 'Dentist' });
  await seed(page, { alarms: [once] });
  await open(page);
  await ringNow(page, once.id);
  await expect(page).toHaveURL(/#\/ring/);
  await page.getByRole('button', { name: 'Turn off' }).click();
  await page.waitForTimeout(1500);
  console.log(page.url());
  console.log(JSON.stringify(await page.evaluate(() => window.__rouseTest!.inspect().log.map(e=>e.type))));
});
