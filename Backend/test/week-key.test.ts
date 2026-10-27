import { expect, it } from 'vitest';
import { toMondayWeekKey } from '../src/lib/weekKey';

it('keeps a Monday and maps the rest of its week to it', () => {
  expect(toMondayWeekKey('2026-10-26')).toBe('2026-10-26');
  expect(toMondayWeekKey('2026-10-27')).toBe('2026-10-26');
  expect(toMondayWeekKey('2026-11-01')).toBe('2026-10-26');
  expect(toMondayWeekKey('2026-11-02')).toBe('2026-11-02');
});

it('rejects malformed and impossible dates', () => {
  expect(toMondayWeekKey('2026-02-30')).toBeNull();
  expect(toMondayWeekKey('2026-1-27')).toBeNull();
});
