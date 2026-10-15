/** Plan §4.2 scenarios 3, 4, 5, 6, 10, 12: ringing, chains, silence lease, snooze, wake-up check, reload. */
import { test, expect, type Page } from '@playwright/test';
import { inspect, installClock, makeAlarm, math, open, ringNow, seed, solveMath, typeOnKeypad, fireNextTimer, T0 } from './helpers';

async function startMission(page: Page) {
  await page.getByRole('button', { name: /Start mission/ }).click();
  await expect(page).toHaveURL(/#\/ring\/mission\/\d/);
}

test('3 · ring → math; a wrong answer keeps it ringing; solving turns it off', async ({ page }) => {
  const alarm = makeAlarm({ hour: 6, minute: 30, label: 'Wake up', missions: [math(2, 1)] });
  await seed(page, { alarms: [alarm] });
  await open(page);
  await ringNow(page, alarm.id);
  await expect(page).toHaveURL(/#\/ring$/);
  const start = page.getByRole('button', { name: /Start mission/ });
  await expect(start).toBeFocused();
  await expect(start).toContainText('Math');
  await expect(page.getByText('Wake up', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Snooze 5 min · 3 left' })).toBeVisible();
  expect((await inspect(page)).audio).toBe('playing');

  await startMission(page);
  await expect(page.getByRole('heading', { name: 'Mission 1 of 1 · Math' })).toBeVisible();
  await expect.poll(async () => (await inspect(page)).audio).toBe('silenced');
  await typeOnKeypad(page, '0');
  await expect(page.getByLabel('Your answer')).toHaveValue('0');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByTestId('mission-feedback')).toHaveText('Not quite. Try again.');
  await expect(page.getByLabel('Your answer')).toHaveValue('');
  expect((await inspect(page)).ring?.state).toBe('ringing');
  await expect(page.getByRole('button', { name: "Can't do this mission?" })).toBeVisible();

  await solveMath(page, 2);
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
  const st = await inspect(page);
  expect(st.ring).toBeNull();
  expect(st.audio).toBe('stopped');
  expect(st.log.find((e) => e.type === 'dismissed')).toMatchObject({ via: 'mission' });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/#\/alarms$/);
});

test('4 · chained missions run in order with a "Next" interstitial', async ({ page }) => {
  const alarm = makeAlarm({
    missions: [math(1, 1), { type: 'typing', phraseMode: 'custom', customPhrase: 'Coffee is waiting for me', strictCase: false, phrases: 1 }, { type: 'tap', targets: 5 }],
  });
  await seed(page, { alarms: [alarm] });
  await open(page);
  await ringNow(page, alarm.id);
  await expect(page.getByRole('button', { name: /Start mission/ })).toContainText('Math, then Typing, then Tap');
  await startMission(page);
  await expect(page.getByRole('heading', { name: 'Mission 1 of 3 · Math' })).toBeVisible();
  await solveMath(page, 1);
  await expect(page.getByText('Next: Typing')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mission 2 of 3 · Typing' })).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Type the phrase' });
  await box.fill('Coffee is waiting for mx');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByTestId('mission-feedback')).toHaveText("A few characters don't match. Look for the ▲ mark.");
  await expect(page.getByTestId('typing-phrase')).toContainText('▲');
  await box.fill('coffee  is waiting for me');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('heading', { name: 'Mission 3 of 3 · Tap' })).toBeVisible();
  for (let k = 1; k <= 5; k++) await page.getByRole('button', { name: `Target ${k}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
});

test('5 · sound is off while solving and comes back after 30 s idle', async ({ page }) => {
  await installClock(page, T0);
  const alarm = makeAlarm({ missions: [math(3, 1)] });
  await seed(page, { alarms: [alarm] });
  await open(page);
  await ringNow(page, alarm.id);
  await startMission(page);
  const meter = page.getByTestId('idle-meter');
  await expect(meter).toContainText('Sound off while you work');
  await expect.poll(async () => (await inspect(page)).audio).toBe('silenced');

  await page.clock.runFor(21_000);
  await expect(meter).toContainText(/Alarm returns in \d+ s/);
  await expect(meter).toHaveAttribute('data-state', 'warning');
  await page.clock.runFor(10_000);
  await expect(meter).toContainText('Alarm is back. Keep going to turn it off.');
  expect((await inspect(page)).audio).toBe('playing');

  // Any interaction silences it again; progress is kept.
  await typeOnKeypad(page, '1');
  await expect(meter).toContainText('Sound off while you work');
  await expect.poll(async () => (await inspect(page)).audio).toBe('silenced');
  await expect(page.getByLabel('Your answer')).toHaveValue('1');
});

test('6a · snooze limit: the button stays visible but disabled', async ({ page }) => {
  await installClock(page, T0);
  const alarm = makeAlarm({ missions: [math(1, 1)], snooze: { enabled: true, intervalMin: 5, maxCount: 2, requireMission: false } });
  await seed(page, { alarms: [alarm] });
  await open(page);
  await ringNow(page, alarm.id);
  await page.getByRole('button', { name: 'Snooze 5 min · 2 left' }).click();
  await expect(page).toHaveURL(/#\/snoozed$/);
  await expect(page.getByTestId('snoozed-until')).toHaveText('Rings again at 06:05');
  await expect(page.getByText('Snoozes left: 1')).toBeVisible();
  expect((await inspect(page)).timers.map((t) => t.kind)).toContain('snooze');

  await fireNextTimer(page);
  await expect(page).toHaveURL(/#\/ring/);
  await expect(page.getByText('Snoozed 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Snooze 5 min · 1 left' }).click();
  await expect(page).toHaveURL(/#\/snoozed$/);
  await fireNextTimer(page);
  await expect(page).toHaveURL(/#\/ring/);
  const snooze = page.getByRole('button', { name: 'No snoozes left' });
  await expect(snooze).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Finish the mission to turn the alarm off.').first()).toBeVisible();
  await snooze.dispatchEvent('click');
  await expect(page).toHaveURL(/#\/ring$/);
  expect((await inspect(page)).ring?.snoozeCount).toBe(2);

  await startMission(page);
  await solveMath(page, 1);
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
});

test('6b · "Snoozing needs the mission too" runs the first mission before snoozing', async ({ page }) => {
  const alarm = makeAlarm({ missions: [math(1, 1)], snooze: { enabled: true, intervalMin: 9, maxCount: 3, requireMission: true } });
  await seed(page, { alarms: [alarm] });
  await open(page);
  await ringNow(page, alarm.id);
  const snooze = page.getByRole('button', { name: /Snooze 9 min · 3 left/ });
  await expect(snooze).toContainText('Finish the mission to snooze');
  await snooze.click();
  await expect(page).toHaveURL(/#\/ring\/mission\/0\?snooze=1$/);
  // "Back to alarm" returns to the alarm face.
  await page.getByRole('button', { name: 'Back to alarm' }).click();
  await expect(page).toHaveURL(/#\/ring$/);
  await snooze.click();
  await solveMath(page, 1);
  await expect(page).toHaveURL(/#\/snoozed$/);
  expect((await inspect(page)).ring?.state).toBe('snoozed');

  // "I'm up: turn it off" runs the chain now and cancels the snooze.
  await page.getByRole('button', { name: "I'm up: turn it off" }).click();
  await solveMath(page, 1);
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
  const st = await inspect(page);
  expect(st.ring).toBeNull();
  expect(st.timers.map((t) => t.kind)).not.toContain('snooze');
});

test('10a · wake-up check: confirm ends the episode', async ({ page }) => {
  const alarm = makeAlarm({ missions: [], wakeUpCheck: { enabled: true, delayMin: 5, windowMin: 2 } });
  await seed(page, { alarms: [alarm] });
  await open(page);
  await ringNow(page, alarm.id);
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
  await expect(page.getByText('Wake-up check in 5 min. Keep your phone nearby.')).toBeVisible();
  await fireNextTimer(page);
  await expect(page).toHaveURL(/#\/wakecheck$/);
  await expect(page.getByRole('timer')).toContainText(/[12]:\d\d/);
  const awake = page.getByRole('button', { name: "I'm awake" });
  await expect(awake).toBeFocused();
  await awake.click();
  await expect(page.getByRole('heading', { name: 'Nice. Have a good day.' })).toBeVisible();
  await expect(page).toHaveURL(/#\/alarms$/, { timeout: 5000 });
  const st = await inspect(page);
  expect(st.ring).toBeNull();
  expect(st.log.map((e) => e.type)).toEqual(expect.arrayContaining(['wake-check-shown', 'wake-check-confirmed', 'episode-ended']));
});

test('10b · wake-up check: no answer re-rings with the mission and no snooze', async ({ page }) => {
  const alarm = makeAlarm({ missions: [math(1, 1)], wakeUpCheck: { enabled: true, delayMin: 5, windowMin: 1 } });
  await seed(page, { alarms: [alarm] });
  await open(page);
  await ringNow(page, alarm.id);
  await startMission(page);
  await solveMath(page, 1);
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
  await fireNextTimer(page); // prompt
  await expect(page).toHaveURL(/#\/wakecheck$/);
  await fireNextTimer(page); // deadline
  await expect(page).toHaveURL(/#\/ring\?reason=wakecheck$/);
  await expect(page.getByText("You didn't answer the wake-up check, so the alarm is back.")).toBeVisible();
  await expect(page.getByRole('button', { name: /Snooze/ })).toHaveCount(0);
  expect((await inspect(page)).log.map((e) => e.type)).toContain('wake-check-failed');
  await startMission(page);
  await solveMath(page, 1);
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
});

test('12 · reloading mid-ring resumes ringing and keeps completed missions', async ({ page }) => {
  const alarm = makeAlarm({ label: 'Reload', missions: [math(1, 1), math(1, 1)] });
  await seed(page, { alarms: [alarm] });
  await open(page);
  await ringNow(page, alarm.id);
  await startMission(page);
  await solveMath(page, 1);
  await expect(page.getByRole('heading', { name: 'Mission 2 of 2 · Math' })).toBeVisible();

  await page.reload();
  await expect(page.locator('html[data-ready="1"]')).toHaveCount(1);
  await expect(page).toHaveURL(/#\/ring\?reason=killed$/);
  await expect(page.getByText("The alarm was interrupted, so it's ringing again.")).toBeVisible();
  const st = await inspect(page);
  expect(st.audio).toBe('playing');
  expect(st.ring?.source).toBe('safety');
  await startMission(page);
  await expect(page.getByRole('heading', { name: 'Mission 2 of 2 · Math' })).toBeVisible();
  await solveMath(page, 1);
  await expect(page.getByRole('heading', { name: 'Good morning' })).toBeVisible();
});
