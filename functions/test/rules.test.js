import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySlot,
  evaluateRange,
  slotStartMs,
  slotKey,
  SLOT,
  bookingWindow,
  bookingIdFor,
  specialReasons,
} from '../shared/calendar.js';
import { dueProgressionEvents, progressStudent } from '../shared/academic.js';
import { niftKey, isValidNiftId } from '../shared/constants.js';
import { DEFAULT_BOOKING_RULES as R } from '../shared/defaults.js';

// Monday 12 Oct 2026, 08:00 IST
const NOW = slotStartMs('2026-10-12', 8);
const MON = '2026-10-12';
const SAT = '2026-10-17';

const cls = (date, hour, extra = {}) =>
  classifySlot({ date, hour, rules: R, nowMs: NOW, ...extra }).state;

test('weekday class hours are CLS CLASS, evening is available, after 10 PM is special', () => {
  assert.equal(cls(MON, 10), SLOT.CLASS);
  assert.equal(cls(MON, 17), SLOT.AVAILABLE);
  assert.equal(cls(MON, 21), SLOT.AVAILABLE);
  assert.equal(cls(MON, 22), SLOT.SPECIAL);
});

test('weekend is special; closed holiday is unavailable; opened holiday is bookable', () => {
  assert.equal(cls(SAT, 11), SLOT.SPECIAL);
  assert.equal(cls('2026-10-14', 18, { holiday: { name: 'X', open: false } }), SLOT.HOLIDAY);
  assert.equal(cls('2026-10-14', 11, { holiday: { name: 'X', open: true } }), SLOT.AVAILABLE);
  assert.equal(cls('2026-10-14', 11, { holiday: { name: 'X', open: true, requiresSpecial: true } }), SLOT.SPECIAL);
});

test('override priority: booking > block > open > normal', () => {
  const open = { type: 'open' };
  const block = { type: 'block' };
  const booked = { bookingId: 'FC-261012-0001', status: 'APPROVED', uid: 'a' };
  assert.equal(cls(MON, 10, { override: open }), SLOT.OVERRIDE_OPEN);
  assert.equal(cls(MON, 18, { override: block }), SLOT.BLOCKED);
  assert.equal(cls(MON, 10, { override: open, slot: booked }), SLOT.BOOKED);
  assert.equal(cls(MON, 10, { override: open, slot: booked, viewerUid: 'a' }), SLOT.MINE);
  assert.equal(cls(MON, 18, { slot: { ...booked, status: 'PENDING_FC_APPROVAL' } }), SLOT.PENDING);
  // released bookings do not hold a slot
  assert.equal(cls(MON, 18, { slot: { ...booked, status: 'CANCELLED_BY_STUDENT' } }), SLOT.AVAILABLE);
});

test('booking window is 7 days for students', () => {
  assert.deepEqual(bookingWindow(R, NOW), { from: MON, to: '2026-10-18' });
  assert.equal(cls('2026-10-19', 18), SLOT.OUTSIDE_WINDOW);
  assert.equal(cls('2026-10-11', 18), SLOT.PAST);
});

test('evaluateRange enforces duration, availability and window', () => {
  const ok = evaluateRange({ date: MON, startHour: 18, endHour: 21, rules: R, nowMs: NOW });
  assert.equal(ok.ok, true);
  assert.equal(ok.requiresSpecial, false);

  assert.equal(evaluateRange({ date: MON, startHour: 17, endHour: 21, rules: R, nowMs: NOW }).ok, false);
  assert.equal(evaluateRange({ date: MON, startHour: 16, endHour: 18, rules: R, nowMs: NOW }).ok, false);
  assert.equal(evaluateRange({ date: '2026-10-20', startHour: 18, endHour: 19, rules: R, nowMs: NOW }).ok, false);

  const late = evaluateRange({ date: MON, startHour: 21, endHour: 23, rules: R, nowMs: NOW });
  assert.equal(late.ok, true);
  assert.equal(late.requiresSpecial, true);

  const slots = { [slotKey(19)]: { bookingId: 'FC-261012-0001', status: 'SUBMITTED', uid: 'x' } };
  assert.equal(evaluateRange({ date: MON, startHour: 18, endHour: 20, rules: R, nowMs: NOW, slots }).ok, false);

  const overrides = { [slotKey(15)]: { type: 'open' }, [slotKey(16)]: { type: 'open' } };
  const opened = evaluateRange({ date: MON, startHour: 15, endHour: 18, rules: R, nowMs: NOW, overrides });
  assert.equal(opened.ok, true);
  assert.equal(opened.usesOverride, true);
});

test('special reasons', () => {
  assert.deepEqual(specialReasons({ date: SAT, startHour: 10, endHour: 12, rules: R }), ['Weekend']);
  assert.deepEqual(specialReasons({ date: MON, startHour: 21, endHour: 23, rules: R }), ['After 10:00 PM']);
});

test('booking ID format', () => {
  assert.equal(bookingIdFor('2026-10-12', 42), 'FC-261012-0042');
});

test('NIFT ID keys', () => {
  assert.equal(niftKey(' bft/23/101 '), 'BFT_23_101');
  assert.equal(isValidNiftId('BFT/23/101'), true);
  assert.equal(isValidNiftId('BFT_23_101'), false);
});

test('semester progression', () => {
  const s = (semester, department = 'FC', status = 'ACTIVE') => ({ semester, department, status });
  assert.deepEqual(progressStudent(s(1), 'oddToEven'), { semester: 2 });
  assert.equal(progressStudent(s(2), 'oddToEven'), null);
  assert.deepEqual(progressStudent(s(6), 'evenToOdd'), { semester: 7 });
  assert.equal(progressStudent(s(8), 'evenToOdd'), null);
  assert.deepEqual(progressStudent(s(8), 'graduation'), { status: 'GRADUATED', bookingAccess: false });
  assert.deepEqual(progressStudent(s(4, 'MFM'), 'graduation'), { status: 'GRADUATED', bookingAccess: false });
  assert.equal(progressStudent(s(4, 'MFM'), 'evenToOdd'), null);
  assert.equal(progressStudent(s(3, 'FC', 'DISABLED'), 'oddToEven'), null);
});

test('progression scheduling only fires near event dates, once', () => {
  assert.deepEqual(dueProgressionEvents('2026-10-12', {}, {}), []);
  assert.deepEqual(dueProgressionEvents('2027-01-01', {}, {}).map((e) => e.key), ['2027-oddToEven']);
  assert.deepEqual(dueProgressionEvents('2027-01-03', {}, { '2027-oddToEven': {} }), []);
  assert.deepEqual(dueProgressionEvents('2027-06-02', {}, {}).map((e) => e.event), ['graduation']);
  assert.deepEqual(dueProgressionEvents('2027-08-01', { autoProgression: false }, {}), []);
});

import { maxHoursFor, needsAssistantApproval } from '../shared/defaults.js';
import { specialStepsFor } from '../shared/constants.js';

test('FC students can book 4 hours, others 3', () => {
  assert.equal(maxHoursFor(R, 'FC_STUDENT'), 4);
  assert.equal(maxHoursFor(R, 'OTHER_DEPT_STUDENT'), 3);
  const four = { date: MON, startHour: 17, endHour: 21, rules: R, nowMs: NOW };
  assert.equal(evaluateRange({ ...four, maxHours: maxHoursFor(R, 'FC_STUDENT') }).ok, true);
  assert.equal(evaluateRange({ ...four, maxHours: maxHoursFor(R, 'OTHER_DEPT_STUDENT') }).ok, false);
});

test('FC Lab Assistant approval scope', () => {
  assert.equal(needsAssistantApproval(R, 'FC_STUDENT'), true);
  assert.equal(needsAssistantApproval({ assistantApproval: 'fc' }, 'OTHER_DEPT_STUDENT'), false);
  assert.equal(needsAssistantApproval({ assistantApproval: 'none' }, 'FC_STUDENT'), false);
});

test('special approval route: other departments add Dept CC / faculty', () => {
  assert.deepEqual(specialStepsFor('FC_STUDENT').map((s) => s.key), ['fcAssistant', 'directorPA', 'director', 'final']);
  assert.deepEqual(specialStepsFor('OTHER_DEPT_STUDENT').map((s) => s.key), ['fcAssistant', 'deptCc', 'directorPA', 'director', 'final']);
});
