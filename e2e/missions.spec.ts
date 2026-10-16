/** Plan §4.2 scenarios 7, 8, 9: fallback after wrong QR scans, QR register/test/mismatch, motion missions. */
import { test, expect, type Page } from '@playwright/test';
import { closeSheet, inspect, injectScan, makeAlarm, math, open, openBlank, ringNow, seed, solveMath } from './helpers';

const QR = { type: 'qr' as const, expectedCode: 'ROUSE-SINK-7f3a', label: 'Bathroom sink' };

test('7 · the backup mission unlocks after 3 wrong QR scans', async ({ page }) => {
  const alarm = makeAlarm({ missions: [QR] });
  await seed(page, { alarms: [alarm], settings: { fallback: { afterFailures: 3, afterMinutes: 5, mission: { type: 'math', difficulty: 1, count: 2 } } } });
  await open(page);
  await ringNow(page, alarm.id);
  await page.getByRole('button', { name: /Start mission/ }).click();
  await expect(page.getByRole('heading', { name: 'Mission 1 of 1 · QR / barcode' })).toBeVisible();
  await expect(page.getByText('Scan the code at Bathroom sink')).toBeVisible();
  await expect(page.getByRole('button', { name: "Can't do this mission?" })).toHaveCount(0);

  await injectScan(page, 'SOMETHING-ELSE-1');
  await expect(page.getByTestId('mission-feedback')).toHaveText("That's a different code. Find the one at Bathroom sink.");
  await page.getByRole('button', { name: "Can't do this mission?" }).click();
  const sheet = page.getByRole('dialog', { name: 'Backup mission' });
  await expect(sheet).toContainText('The backup mission unlocks after 3 tries or 5 minutes. So far: 1 try, 0 min.');
  await sheet.getByRole('button', { name: 'Keep trying' }).click();

  await injectScan(page, 'SOMETHING-ELSE-2');
  await injectScan(page, 'SOMETHING-ELSE-3');
  await page.getByRole('button', { name: "Can't do this mission?" }).click();
  await expect(page).toHaveURL(/#\/ring\/fallback$/);
  await expect(page.getByRole('heading', { name: 'Switch to the backup mission?' })).toBeVisible();
  await expect(page.getByText(/The backup is longer on purpose: 2 math problems, very easy\./)).toBeVisible();
  await page.getByRole('button', { name: 'Start backup mission' }).click();
  await expect(page.getByRole('heading', { name: 'Mission 1 of 1 · Backup: Math' })).toBeVisible();
  await expect(page.getByRole('button', { name: "Can't do this mission?" })).toHaveCount(0);
  await solveMath(page, 2);
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
  expect((await inspect(page)).log.find((e) => e.type === 'dismissed')).toMatchObject({ via: 'fallback' });
});

test('8 · register a QR code, test it, then ring: mismatch and success', async ({ page }) => {
  await seed(page);
  await open(page);
  await page.getByRole('button', { name: 'Create your first alarm' }).click();
  await openBlank(page, 'Missions');
  await page.getByRole('button', { name: 'Remove Math' }).click();
  await page.getByRole('button', { name: 'Add mission' }).click();
  await page.getByTestId('tile-qr').click();
  await page.getByRole('textbox', { name: 'Where is it?' }).fill('Bathroom sink');
  await page.getByRole('button', { name: 'Scan a code' }).click();
  await expect(page.getByText('Point at a QR code or barcode.')).toBeVisible();
  await injectScan(page, 'https://example.org/rouse/7f3a');
  const found = page.getByRole('dialog', { name: 'Code found' });
  await expect(found).toBeVisible();
  await found.getByRole('button', { name: 'Use this code' }).click();
  await expect(page.getByTestId('qr-status')).toContainText('Code saved');
  await expect(page.getByTestId('qr-status')).toContainText('7f3a');

  await page.getByRole('button', { name: 'Test scan now' }).click();
  await injectScan(page, 'a different code');
  await expect(page.getByTestId('test-scan-result')).toHaveText('Different code. This alarm wants the one at Bathroom sink.');
  await page.getByRole('button', { name: 'Scan again' }).click();
  await injectScan(page, 'https://example.org/rouse/7f3a');
  await expect(page.getByTestId('test-scan-result')).toHaveText("That's the one. ✓");
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('mission-row')).toContainText('Bathroom sink');
  await closeSheet(page);
  await page.getByRole('button', { name: 'Save alarm' }).click();
  await expect(page).toHaveURL(/#\/alarms$/);

  const id = await page.getByTestId('alarm-card').getAttribute('data-alarm-id');
  await ringNow(page, id!);
  await page.getByRole('button', { name: /Start mission/ }).click();
  await injectScan(page, 'not it');
  await expect(page.getByTestId('mission-feedback')).toHaveText("That's a different code. Find the one at Bathroom sink.");
  expect((await inspect(page)).ring?.state).toBe('ringing');
  await injectScan(page, 'https://example.org/rouse/7f3a');
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
});

async function feedMotion(page: Page, kind: 'shake' | 'walk', durationMs: number) {
  await page.evaluate(
    async ({ kind, durationMs }) => {
      const start = performance.now();
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const fire = (z: number) =>
        window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: 0, y: 0, z }, interval: 20 }));
      let lastSpike = -1000;
      while (performance.now() - start < durationMs) {
        const t = performance.now() - start;
        if (kind === 'shake') {
          if (t - lastSpike >= 320) {
            fire(9.8 + 16);
            lastSpike = t;
          } else fire(9.8);
        } else {
          fire(9.81 + 3 * Math.sin((2 * Math.PI * t) / 550));
        }
        await sleep(20);
      }
    },
    { kind, durationMs },
  );
}

test('9 · shake and steps missions count synthetic DeviceMotionEvents', async ({ page }) => {
  test.setTimeout(60_000);
  const alarm = makeAlarm({ missions: [{ type: 'shake', count: 10, sensitivity: 'low' }, { type: 'steps', count: 10 }] });
  await seed(page, { alarms: [alarm] });
  await open(page);
  // The capability probe needs at least one sample, as a real phone would deliver.
  await feedMotion(page, 'walk', 100);
  await ringNow(page, alarm.id);
  await page.getByRole('button', { name: /Start mission/ }).click();
  await expect(page.getByRole('heading', { name: 'Mission 1 of 2 · Shake' })).toBeVisible();
  await expect(page.getByText('Shake the phone hard')).toBeVisible();
  await feedMotion(page, 'shake', 1500);
  const shakes = Number(await page.getByTestId('motion-count').textContent());
  expect(shakes).toBeGreaterThan(0);
  expect(shakes).toBeLessThan(10);
  await expect(page.getByRole('progressbar', { name: 'Shakes' })).toHaveAttribute('aria-valuenow', String(shakes));
  await feedMotion(page, 'shake', 3000);
  await expect(page.getByRole('heading', { name: 'Mission 2 of 2 · Steps' })).toBeVisible();
  await expect(page.getByText('Walk around. Keep this screen on.')).toBeVisible();
  await feedMotion(page, 'walk', 9000);
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
});

test('9b · without motion events the motion mission offers the backup at once', async ({ page }) => {
  const alarm = makeAlarm({ missions: [{ type: 'steps', count: 10 }] });
  await seed(page, { alarms: [alarm], settings: { fallback: { afterFailures: 3, afterMinutes: 5, mission: math(2, 1) as never } } });
  await open(page);
  await ringNow(page, alarm.id);
  // No sensor on this "device": the plan already swaps steps for the backup mission (D-029).
  await page.getByRole('button', { name: /Start mission/ }).click();
  await expect(page.getByRole('heading', { name: /Mission 1 of 1 · Math/ })).toBeVisible();
});
