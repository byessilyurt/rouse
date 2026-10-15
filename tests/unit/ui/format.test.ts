import { describe, expect, it } from 'vitest';
import {
  fallbackDescription,
  formatClockCountdown,
  formatDuration,
  formatIn,
  formatInSpoken,
  formatTime,
  missionSummary,
  repeatSummary,
  resolveUse24h,
  weekOrder,
  weekdayName,
} from '../../../src/ui/format';

const MIN = 60_000;

describe('format', () => {
  it('formats times in 24 h and 12 h', () => {
    expect(formatTime(6, 30, true)).toBe('06:30');
    expect(formatTime(6, 30, false)).toBe('6:30 AM');
    expect(formatTime(0, 5, false)).toBe('12:05 AM');
    expect(formatTime(12, 0, false)).toBe('12:00 PM');
    expect(resolveUse24h('24h')).toBe(true);
    expect(resolveUse24h('12h')).toBe(false);
    expect(resolveUse24h('system', 'en-GB')).toBe(true);
    expect(resolveUse24h('system', 'en-US')).toBe(false);
  });

  it('formats the relative "in" text with minutes rounded up', () => {
    expect(formatIn(30_000)).toBe('in under a minute');
    expect(formatIn(45 * MIN)).toBe('in 45 m');
    expect(formatIn(7 * 60 * MIN + 11 * MIN + 1)).toBe('in 7 h 12 m');
    expect(formatIn(2 * 60 * MIN)).toBe('in 2 h');
    expect(formatIn(27 * 60 * MIN)).toBe('in 1 d 3 h');
    expect(formatInSpoken(7 * 60 * MIN + 12 * MIN)).toBe('in 7 hours 12 minutes');
    expect(formatInSpoken(61 * MIN)).toBe('in 1 hour 1 minute');
  });

  it('formats durations and countdowns', () => {
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(108_000)).toBe('1 min 48 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatClockCountdown(90_000)).toBe('1:30');
    expect(formatClockCountdown(599_400)).toBe('10:00');
  });

  it('summarises repeat days', () => {
    expect(repeatSummary([0, 1, 2, 3, 4, 5, 6], 1, null, 0)).toBe('Every day');
    expect(repeatSummary([1, 2, 3, 4, 5], 1, null, 0)).toBe('Weekdays');
    expect(repeatSummary([0, 6], 1, null, 0)).toBe('Weekends');
    expect(repeatSummary([1, 3, 5], 1, null, 0)).toBe('Mon, Wed, Fri');
    expect(repeatSummary([0, 3], 1, null, 0)).toBe('Wed, Sun');
    expect(repeatSummary([0, 3], 0, null, 0)).toBe('Sun, Wed');
    const now = new Date(2026, 9, 15, 6, 0).getTime();
    expect(repeatSummary([], 1, now + 60 * MIN, now)).toBe('Once · today');
    expect(repeatSummary([], 1, now + 24 * 60 * MIN, now)).toBe('Once · tomorrow');
  });

  it('names weekdays in week order', () => {
    expect(weekOrder(1)[0]).toBe(1);
    expect(weekOrder(0)[0]).toBe(0);
    expect(weekdayName(1, 'long')).toBe('Monday');
    expect(weekdayName(0, 'short')).toBe('Sun');
    expect(weekdayName(4, 'narrow')).toBe('T');
  });

  it('summarises missions in plain words', () => {
    expect(missionSummary({ type: 'math', difficulty: 3, count: 3 })).toBe('Medium · 3 problems');
    expect(missionSummary({ type: 'math', difficulty: 2, count: 1 })).toBe('Easy · 1 problem');
    expect(missionSummary({ type: 'qr', expectedCode: 'x', label: 'Bathroom sink' })).toBe('Bathroom sink');
    expect(missionSummary({ type: 'qr', expectedCode: '', label: '' })).toBe('Code not set');
    expect(missionSummary({ type: 'shake', count: 30, sensitivity: 'high' })).toBe('30 shakes · Hard');
    expect(fallbackDescription({ type: 'math', difficulty: 3, count: 20 })).toBe('20 math problems, medium');
    expect(fallbackDescription({ type: 'typing', phraseMode: 'random', customPhrase: '', strictCase: false, phrases: 3 })).toBe('typing 3 long phrases');
  });
});
