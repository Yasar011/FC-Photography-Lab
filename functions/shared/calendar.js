// Calendar & slot rules shared by the backend (authoritative) and the web UI.
// All dates are "YYYY-MM-DD" strings in IST; slots are whole hours (0–24).

import {
  IST_OFFSET_MINUTES,
  PENDING_STATUSES,
  SLOT_HOLDING_STATUSES,
  STATUS,
} from './constants.js';
import { withRuleDefaults } from './defaults.js';

const pad = (n) => String(n).padStart(2, '0');
const OFFSET_MS = IST_OFFSET_MINUTES * 60000;

export function istParts(ms = Date.now()) {
  const d = new Date(ms + OFFSET_MS);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

export const todayIST = (ms = Date.now()) => istParts(ms).date;

export function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function utcOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(dateStr, n) {
  const d = new Date(utcOf(dateStr) + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const diffDays = (a, b) => Math.round((utcOf(b) - utcOf(a)) / 86400000);
export const dayOfWeek = (dateStr) => new Date(utcOf(dateStr)).getUTCDay();

/** Epoch ms at which the given IST date + hour starts. */
export const slotStartMs = (dateStr, hour) => utcOf(dateStr) + hour * 3600000 - OFFSET_MS;

/** RTDB key for an hour slot. Prefixed so RTDB never coerces a day into an array. */
export const slotKey = (hour) => `h${String(hour).padStart(2, '0')}`;
export const hourFromKey = (key) => Number(String(key).slice(1));

export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startOfWeek(dateStr) {
  // Monday-based weeks
  const dow = dayOfWeek(dateStr);
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

// ---- Formatting -------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_NAMES = DAYS;

export function formatHour(h) {
  const hh = ((h + 11) % 12) + 1;
  const suffix = h % 24 < 12 ? 'AM' : 'PM';
  return `${hh}:00 ${suffix}`;
}

export function formatRange(start, end) {
  return `${formatHour(start)} – ${formatHour(end)}`;
}

export function formatDate(dateStr, { weekday = false } = {}) {
  if (!isValidDateStr(dateStr)) return dateStr || '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = `${d} ${MONTHS[m - 1]} ${y}`;
  return weekday ? `${DAYS[dayOfWeek(dateStr)]}, ${base}` : base;
}

export function formatDateTime(ms) {
  if (!ms) return '';
  const p = istParts(ms);
  const h = ((p.hour + 11) % 12) + 1;
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year} — ${h}:${pad(p.minute)} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

// ---- Booking window ------------------------------------------------------------
export function bookingWindow(rules, nowMs = Date.now(), staff = false) {
  const r = withRuleDefaults(rules);
  const from = todayIST(nowMs);
  const days = Math.max(1, Number(staff ? r.staffBookingWindowDays : r.bookingWindowDays) || 7);
  return { from, to: addDays(from, days - 1) };
}

// ---- Slot classification ----------------------------------------------------------
export const SLOT = {
  AVAILABLE: 'AVAILABLE',
  OVERRIDE_OPEN: 'OVERRIDE_OPEN',
  SPECIAL: 'SPECIAL',
  BOOKED: 'BOOKED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  MINE: 'MINE',
  BLOCKED: 'BLOCKED',
  CLASS: 'CLASS',
  HOLIDAY: 'HOLIDAY',
  CLOSED: 'CLOSED',
  PAST: 'PAST',
  OUTSIDE_WINDOW: 'OUTSIDE_WINDOW',
};

export const SLOT_LABELS = {
  AVAILABLE: 'Available',
  OVERRIDE_OPEN: 'Available — Admin Override',
  SPECIAL: 'Special Approval',
  BOOKED: 'Booked',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  MINE: 'Your Booking',
  BLOCKED: 'Blocked',
  CLASS: 'CLS Class',
  HOLIDAY: 'Holiday',
  CLOSED: 'Closed',
  PAST: 'Past',
  OUTSIDE_WINDOW: 'Not yet open',
};

export const BOOKABLE_STATES = [SLOT.AVAILABLE, SLOT.OVERRIDE_OPEN, SLOT.SPECIAL];

export function isSlotOccupied(slot) {
  return Boolean(slot && slot.bookingId && SLOT_HOLDING_STATUSES.includes(slot.status));
}

/**
 * Decide what a single hour on a date looks like for a viewer.
 * Priority: 1. existing booking  2. admin block  3. admin opening  4. normal rules.
 */
export function classifySlot({
  date,
  hour,
  rules,
  holiday = null,
  override = null,
  slot = null,
  nowMs = Date.now(),
  viewerUid = null,
  staffView = false,
  ignoreWindow = false,
}) {
  const r = withRuleDefaults(rules);
  const base = { date, hour, bookable: false, requiresSpecial: false };

  // 1. Existing booking always wins.
  if (isSlotOccupied(slot)) {
    const pending = PENDING_STATUSES.includes(slot.status);
    let state;
    if (viewerUid && slot.uid === viewerUid) state = SLOT.MINE;
    else if (pending) state = SLOT.PENDING;
    else state = staffView && slot.status !== STATUS.COMPLETED ? SLOT.APPROVED : SLOT.BOOKED;
    return { ...base, state, bookingId: slot.bookingId, status: slot.status };
  }

  if (slotStartMs(date, hour) < nowMs) return { ...base, state: SLOT.PAST };

  // 2. Admin block.
  if (override && override.type === 'block') {
    return { ...base, state: SLOT.BLOCKED, reason: override.reason || '' };
  }

  let result;
  // 3. Admin manual opening.
  if (override && override.type === 'open') {
    result = {
      ...base,
      state: override.requiresSpecial ? SLOT.SPECIAL : SLOT.OVERRIDE_OPEN,
      bookable: true,
      requiresSpecial: Boolean(override.requiresSpecial),
      override: true,
      reason: override.reason || '',
    };
  } else {
    result = normalRules({ date, hour, r, holiday, base });
  }

  if (result.bookable && !ignoreWindow) {
    const w = bookingWindow(r, nowMs, false);
    if (date < w.from || date > w.to) return { ...base, state: SLOT.OUTSIDE_WINDOW };
  }
  return result;
}

function normalRules({ date, hour, r, holiday, base }) {
  if (hour < r.gridStartHour || hour >= r.gridEndHour) return { ...base, state: SLOT.CLOSED };
  const special = { ...base, state: SLOT.SPECIAL, bookable: true, requiresSpecial: true };
  const open = { ...base, state: SLOT.AVAILABLE, bookable: true };
  const afterHours = r.afterHoursEnabled ? special : { ...base, state: SLOT.CLOSED };

  if (holiday) {
    if (!holiday.open) return { ...base, state: SLOT.HOLIDAY, reason: holiday.name || 'Public holiday' };
    if (hour < r.holidayOpenStartHour) return { ...base, state: SLOT.CLOSED };
    if (hour >= r.regularEndHour) return afterHours;
    return holiday.requiresSpecial ? special : open;
  }

  const dow = dayOfWeek(date);
  if ((r.weekendDays || []).includes(dow)) {
    if (!r.weekendBookingEnabled || hour < r.weekendStartHour) return { ...base, state: SLOT.CLOSED };
    return special;
  }

  if (hour >= r.regularEndHour) return afterHours;
  if ((r.classDays || []).includes(dow) && hour >= r.classStartHour && hour < r.classEndHour) {
    return { ...base, state: SLOT.CLASS, label: r.classLabel };
  }
  return open;
}

/**
 * Validate a contiguous range [startHour, endHour) against the slot rules.
 * Returns { ok, errors, requiresSpecial, usesOverride, states }.
 */
export function evaluateRange({
  date,
  startHour,
  endHour,
  rules,
  holiday,
  overrides = {},
  slots = {},
  nowMs = Date.now(),
  staff = false,
  maxHours = null,
}) {
  const r = withRuleDefaults(rules);
  const errors = [];
  const s = Number(startHour);
  const e = Number(endHour);
  if (!isValidDateStr(date)) errors.push('Invalid date.');
  if (!Number.isInteger(s) || !Number.isInteger(e) || e <= s) errors.push('Invalid time range.');
  if (errors.length) return { ok: false, errors, requiresSpecial: false, usesOverride: false, states: [] };

  const maxH = maxHours ?? r.maxDurationHours;
  if (e - s > maxH) errors.push(`Maximum booking duration is ${maxH} hours.`);

  const w = bookingWindow(r, nowMs, staff);
  if (date < w.from || date > w.to) {
    errors.push(
      staff
        ? `Staff bookings are limited to the next ${r.staffBookingWindowDays} days.`
        : `Students can only book within the next ${r.bookingWindowDays} days.`,
    );
  }

  const states = [];
  let requiresSpecial = false;
  let usesOverride = false;
  for (let h = s; h < e; h++) {
    const st = classifySlot({
      date,
      hour: h,
      rules: r,
      holiday,
      override: overrides?.[slotKey(h)] || null,
      slot: slots?.[slotKey(h)] || null,
      nowMs,
      ignoreWindow: true,
    });
    states.push(st);
    if (!st.bookable) {
      const what =
        st.state === SLOT.BOOKED || st.state === SLOT.PENDING || st.state === SLOT.MINE
          ? 'already booked'
          : `not available (${SLOT_LABELS[st.state] || st.state})`;
      errors.push(`${formatRange(h, h + 1)} is ${what}.`);
    }
    if (st.requiresSpecial) requiresSpecial = true;
    if (st.override) usesOverride = true;
  }
  return { ok: errors.length === 0, errors, requiresSpecial, usesOverride, states };
}

/** Human-readable reasons a range needs the special approval workflow. */
export function specialReasons({ date, startHour, endHour, rules, holiday, overrides = {} }) {
  const r = withRuleDefaults(rules);
  const reasons = new Set();
  for (let h = startHour; h < endHour; h++) {
    const o = overrides?.[slotKey(h)];
    if (o && o.type === 'open') {
      if (o.requiresSpecial) reasons.add('Special availability (approval required)');
      continue;
    }
    if (holiday?.open) {
      if (holiday.requiresSpecial) reasons.add('Public holiday');
      else if (h >= r.regularEndHour) reasons.add(`After ${formatHour(r.regularEndHour)}`);
      continue;
    }
    if ((r.weekendDays || []).includes(dayOfWeek(date))) reasons.add('Weekend');
    else if (h >= r.regularEndHour) reasons.add(`After ${formatHour(r.regularEndHour)}`);
  }
  return [...reasons];
}

export function bookingIdFor(dateStr, seq) {
  const [y, m, d] = dateStr.split('-');
  return `FC-${y.slice(2)}${m}${d}-${String(seq).padStart(4, '0')}`;
}

// ---- When students may submit a booking ---------------------------------------
const hourLabel = (h) => formatHour(Math.floor(h));

/**
 * Students make regular bookings only during office hours, and special bookings
 * (after 10 PM / weekend / holiday) only in the morning and well ahead, so the
 * paper form can reach the Director. Returns a message, or '' when allowed.
 */
export function submissionProblem({ rules, nowMs = Date.now(), isSpecial, startAt }) {
  const p = istParts(nowMs);
  const h = p.hour + p.minute / 60;
  if (isSpecial) {
    const open = Number(rules.specialBookingOpenHour ?? 9);
    const close = Number(rules.specialBookingCloseHour ?? 14);
    if (h < open || h >= close) {
      return `Special bookings (after 10 PM, weekend or holiday) can only be requested between ${hourLabel(open)} and ${hourLabel(close)}.`;
    }
    const notice = Number(rules.specialMinNoticeHours ?? 24);
    if (startAt && startAt - nowMs < notice * 3600000) {
      return `Special bookings must be requested at least ${notice} hours before they start, so the form can be signed by the Director.`;
    }
    return '';
  }
  const open = Number(rules.regularBookingOpenHour ?? 9);
  const close = Number(rules.regularBookingCloseHour ?? 16);
  if (h < open || h >= close) return `Bookings can only be made between ${hourLabel(open)} and ${hourLabel(close)}.`;
  return '';
}
