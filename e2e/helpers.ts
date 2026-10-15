/**
 * E2E helpers: seed persisted state, boot the app with test hooks (?e2e=1), drive the web backend
 * through window.__rouseTest, and solve missions from what is on screen.
 */
import { expect, type Page } from '@playwright/test';
import { createAlarm, defaultSettings } from '../src/core/defaults';
import type { Alarm, MissionConfig, Settings } from '../src/core/types';

export const T0 = new Date('2026-10-15T06:00:00+01:00').getTime(); // Thu 15 Oct 2026, 06:00 London (BST)

let idCounter = 0;
export function makeAlarm(patch: Partial<Alarm> = {}, now = T0): Alarm {
  idCounter++;
  const base = createAlarm({ id: `a-${idCounter}-${Math.random().toString(16).slice(2, 8)}`, now: now + idCounter });
  return { ...base, missions: [], ...patch };
}

export function math(count = 1, difficulty: 1 | 2 | 3 | 4 | 5 = 1): MissionConfig {
  return { type: 'math', difficulty, count };
}

export interface SeedOptions {
  alarms?: Alarm[];
  settings?: Partial<Settings>;
  onboarded?: boolean;
}

/** Seed `rouse.state` before the app loads (only if empty, so reloads keep state). */
export async function seed(page: Page, opts: SeedOptions = {}): Promise<void> {
  const settings: Settings = { ...defaultSettings(), clockFormat: '24h', theme: 'dark', onboardingDone: opts.onboarded ?? true, ...opts.settings };
  const state = {
    schemaVersion: 1,
    alarms: opts.alarms ?? [],
    settings,
    wakeRecords: [],
    meta: { lastAppliedLogSeq: 0, createdAt: T0 - 86_400_000 },
  };
  await page.addInitScript((json: string) => {
    if (!localStorage.getItem('rouse.state')) localStorage.setItem('rouse.state', json);
  }, JSON.stringify(state));
}

/** Install the fake clock at `time` (it keeps flowing in real time unless paused). */
export async function installClock(page: Page, time = T0): Promise<void> {
  await page.clock.install({ time });
}

export async function open(page: Page, hash = '/alarms'): Promise<void> {
  await page.goto(`/?e2e=1#${hash}`);
  await expect(page.locator('html[data-ready="1"]')).toHaveCount(1);
}

export async function inspect(page: Page) {
  return page.evaluate(() => window.__rouseTest!.inspect());
}

export async function ringNow(page: Page, alarmId: string): Promise<string> {
  return page.evaluate((id) => window.__rouseTest!.ringNow(id), alarmId);
}

export async function fireNextTimer(page: Page): Promise<void> {
  await page.evaluate(() => window.__rouseTest!.fireNextTimer());
}

export async function injectScan(page: Page, text: string): Promise<void> {
  await expect(page.locator('[data-scanner-state="running"]')).toHaveCount(1);
  await page.evaluate((t) => window.__rouseTest!.injectScan(t), text);
}

/** Evaluate the math prompt on screen ("34 × 3 + 18"). */
export async function mathAnswer(page: Page): Promise<string> {
  const text = (await page.getByTestId('math-problem').locator('[aria-hidden="true"]').textContent()) ?? '';
  const expr = text.replace('= ?', '').replace(/×/g, '*').replace(/−/g, '-').replace(/÷/g, '/').trim();
  // eslint-disable-next-line no-new-func
  return String(Function(`"use strict"; return (${expr});`)());
}

export async function typeOnKeypad(page: Page, digits: string): Promise<void> {
  const pad = page.getByRole('group', { name: 'Number pad' });
  for (const d of digits) await pad.getByRole('button', { name: d, exact: true }).click();
}

/** Solve every remaining math problem of the current mission. */
export async function solveMath(page: Page, problems: number): Promise<void> {
  for (let i = 0; i < problems; i++) {
    await expect(page.getByTestId('math-problem')).toBeVisible();
    const before = await page.getByTestId('math-problem').textContent();
    await typeOnKeypad(page, await mathAnswer(page));
    await page.getByRole('button', { name: 'Check answer' }).click();
    if (i < problems - 1) await expect(page.getByTestId('math-problem')).not.toHaveText(before ?? '');
  }
}

export async function startRingingAndOpen(page: Page, alarmId: string): Promise<void> {
  await ringNow(page, alarmId);
  await expect(page).toHaveURL(/#\/ring/);
  await expect(page.getByRole('button', { name: /Start mission|Turn off/ })).toBeVisible();
}
