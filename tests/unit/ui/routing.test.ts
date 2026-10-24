import { describe, expect, it } from 'vitest';
import { matchRoute, isLockedRoute, showsOverLockRoute } from '../../../src/ui/App';
import { parseHash } from '../../../src/ui/router';
import { summarizeHealth } from '../../../src/ui/health';
import { editorIssues, sectionOf, unregisteredQrIndexes } from '../../../src/ui/screens/AlarmEditor';
import { previewBackup } from '../../../src/ui/screens/Settings';
import { createAlarm } from '../../../src/core/defaults';
import type { HealthStatus } from '../../../src/platform/AlarmBackend';

describe('hash routes (design.md §2)', () => {
  const m = (h: string) => matchRoute(parseHash(h));
  it('matches every route', () => {
    expect(m('#/alarms')).toEqual({ name: 'alarms' });
    expect(m('#/onboarding')).toEqual({ name: 'onboarding', step: 1 });
    expect(m('#/onboarding/3')).toEqual({ name: 'onboarding', step: 3 });
    expect(m('#/alarm/new')).toEqual({ name: 'editor', id: 'new' });
    expect(m('#/alarm/abc/missions')).toEqual({ name: 'picker', id: 'abc' });
    expect(m('#/alarm/abc/missions/1?type=qr')).toEqual({ name: 'missionConfig', id: 'abc', index: 1, type: 'qr' });
    expect(m('#/alarm/abc/missions/0/qr?test=1')).toEqual({ name: 'qr', id: 'abc', index: 0, test: true });
    expect(m('#/ring?alarmId=x&test=1')).toEqual({ name: 'ring' });
    expect(m('#/ring/mission/2?snooze=1')).toEqual({ name: 'mission', step: 2, snooze: true });
    expect(m('#/ring/fallback')).toEqual({ name: 'fallback' });
    expect(m('#/wakecheck')).toEqual({ name: 'wakecheck' });
    expect(m('#/settings/licences')).toEqual({ name: 'licences' });
    expect(m('#/nope')).toEqual({ name: 'unknown' });
    expect(m('')).toEqual({ name: 'unknown' });
  });
  it('marks ring, mission, fallback and wake-check routes as locked', () => {
    for (const h of ['#/ring', '#/ring/mission/0', '#/ring/fallback', '#/wakecheck']) expect(isLockedRoute(parseHash(h))).toBe(true);
    for (const h of ['#/alarms', '#/snoozed', '#/done', '#/health']) expect(isLockedRoute(parseHash(h))).toBe(false);
  });
  it('keeps only the ring and post-ring screens over the lock screen (D-082)', () => {
    for (const h of ['#/ring', '#/ring/mission/0', '#/ring/fallback', '#/wakecheck', '#/done', '#/snoozed']) expect(showsOverLockRoute(parseHash(h))).toBe(true);
    for (const h of ['#/alarms', '#/alarm/x', '#/settings', '#/health', '#/stats']) expect(showsOverLockRoute(parseHash(h))).toBe(false);
  });
});

describe('editor validation helpers', () => {
  it('blocks an unregistered QR mission with the fixed message', () => {
    const a = { ...createAlarm({ id: 'x', now: 0 }), missions: [{ type: 'qr' as const, expectedCode: '', label: '' }] };
    expect(unregisteredQrIndexes(a)).toEqual([0]);
    const issues = editorIssues(a, false);
    expect(issues[0]).toEqual({ path: 'missions.0.expectedCode', message: 'Scan a code for the QR mission, or remove it.' });
    expect(editorIssues({ ...a, missions: [] }, false)).toEqual([]);
  });
  it('maps issue paths to editor sections', () => {
    expect(sectionOf('hour')).toBe('time');
    expect(sectionOf('days.0')).toBe('repeat');
    expect(sectionOf('snooze.maxCount')).toBe('snooze');
    expect(sectionOf('missions.1.count')).toBe('missions');
    expect(sectionOf('wakeUpCheck.delayMin')).toBe('wakecheck');
  });
});

describe('backup preview', () => {
  it('classifies bad files with the design copy', () => {
    expect(previewBackup('nope')).toEqual({ ok: false, error: "Couldn't read the file. Try exporting it again." });
    expect(previewBackup('{"a":1}')).toEqual({ ok: false, error: "This file isn't a Rouse backup." });
    expect(previewBackup('{"format":"rouse-backup","version":2}')).toEqual({
      ok: false,
      error: 'This backup is from a newer version of Rouse. Update the app, then try again.',
    });
  });
});

describe('health summary pill', () => {
  const status = (checks: HealthStatus['checks'], platform: 'android' | 'web' = 'android'): HealthStatus => ({ platform, sdkInt: 34, manufacturer: null, checks, checkedAt: 0 });
  it('is honest on the web and counts real issues on Android', () => {
    expect(summarizeHealth(status([], 'web')).text).toBe('Demo mode');
    expect(summarizeHealth(status([])).text).toBe('Ready');
    expect(summarizeHealth(status([{ id: 'batteryOptimization', state: 'action-needed', severity: 'recommended', fix: 'request-permission', detail: '' }])).text).toBe('1 issue');
    expect(summarizeHealth(status([{ id: 'exactAlarm', state: 'action-needed', severity: 'critical', fix: 'open-settings', detail: '' }]))).toMatchObject({ tone: 'error', text: "Can't ring" });
    expect(summarizeHealth(status([{ id: 'camera', state: 'action-needed', severity: 'optional', fix: 'request-permission', detail: '' }])).text).toBe('Ready');
  });
});
