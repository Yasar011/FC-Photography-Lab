// Administrative operations: calendar overrides, holidays, students, admins, settings.
import { onCall } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';

import {
  db,
  fail,
  getActor,
  requireRole,
  loadSettings,
  auditEntry,
  actorRef,
  str,
  TS,
  BOOKING_STAFF_ROLES,
  ADMIN_ROLES,
} from './core.js';
import { applyProgression } from './academicJob.js';
import {
  ROLES,
  DEPARTMENTS,
  STUDENT_TYPES,
  ACCOUNT_STATUS,
  ACTIVE_STATUSES,
  isValidSemester,
  isPhone,
  niftKey,
  emailKey,
  isAllowedEmail,
  isValidEmail,
} from '../shared/constants.js';
import {
  classifySlot,
  isSlotOccupied,
  isValidDateStr,
  slotKey,
  slotStartMs,
  formatRange,
  SLOT_LABELS,
} from '../shared/calendar.js';
import { PROGRESSION_EVENTS } from '../shared/academic.js';

// ---- Slot overrides ------------------------------------------------------------
function parseHours(hours) {
  const list = [...new Set((Array.isArray(hours) ? hours : []).map(Number))].sort((a, b) => a - b);
  if (!list.length || list.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) {
    fail('invalid-argument', 'Please select valid hour slots.');
  }
  return list;
}

export const setSlotOverride = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, BOOKING_STAFF_ROLES, 'Only Staff Admin can change calendar availability.');
  const d = request.data || {};
  const date = str(d.date, 10);
  if (!isValidDateStr(date)) fail('invalid-argument', 'Invalid date.');
  const type = d.type;
  if (!['open', 'block'].includes(type)) fail('invalid-argument', 'Invalid override type.');
  const hours = parseHours(d.hours);
  const reason = str(d.reason, 500);
  if (!reason) fail('invalid-argument', 'Please enter a reason/remarks for this override.');
  if (hours.some((h) => slotStartMs(date, h) < Date.now())) fail('failed-precondition', 'Past slots cannot be changed.');

  const settings = await loadSettings();
  const [holidaySnap, slotsSnap] = await Promise.all([
    db.ref(`settings/holidays/${date}`).get(),
    db.ref(`bookingSlots/${date}`).get(),
  ]);
  const slots = slotsSnap.val() || {};
  const by = actorRef(actor);
  const updates = {};
  const kind = d.kind === 'special' ? 'special' : 'slot';

  for (const h of hours) {
    if (type === 'open' && isSlotOccupied(slots[slotKey(h)])) continue; // existing booking wins
    const original = classifySlot({
      date, hour: h, rules: settings.bookingRules, holiday: holidaySnap.val(), ignoreWindow: true,
    });
    updates[`settings/availabilityOverrides/${date}/${slotKey(h)}`] = {
      type,
      kind,
      requiresSpecial: type === 'open' && d.requiresSpecial === true,
      reason,
      originalRestriction: original.label || SLOT_LABELS[original.state] || original.state,
      byUid: actor.uid,
      byName: actor.name,
      at: TS,
    };
  }
  if (!Object.keys(updates).length) fail('failed-precondition', 'All selected slots are already booked.');
  await db.ref().update(updates);

  // A block must never displace a booking: write first, then check, then undo.
  if (type === 'block') {
    const latest = (await db.ref(`bookingSlots/${date}`).get()).val() || {};
    const clash = hours.filter((h) => isSlotOccupied(latest[slotKey(h)]));
    if (clash.length) {
      const undo = {};
      for (const h of clash) undo[`settings/availabilityOverrides/${date}/${slotKey(h)}`] = null;
      await db.ref().update(undo);
      if (clash.length === hours.length) {
        fail('failed-precondition', 'These slots already have an active booking. Cancel the booking first.');
      }
    }
  }

  const action = type === 'block' ? 'SLOT_BLOCKED' : kind === 'special' ? 'SPECIAL_AVAILABILITY' : 'SLOT_OPENED';
  const [ap, av] = auditEntry(by, action, {
    details: { date, hours: hours.map((h) => formatRange(h, h + 1)), reason, requiresSpecial: d.requiresSpecial === true },
  });
  await db.ref(ap).set(av);
  return { ok: true };
});

export const removeSlotOverride = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, BOOKING_STAFF_ROLES);
  const date = str(request.data?.date, 10);
  if (!isValidDateStr(date)) fail('invalid-argument', 'Invalid date.');
  const hours = parseHours(request.data?.hours);
  const existing = (await db.ref(`settings/availabilityOverrides/${date}`).get()).val() || {};
  const updates = {};
  const removed = [];
  for (const h of hours) {
    if (!existing[slotKey(h)]) continue;
    removed.push({ hour: formatRange(h, h + 1), was: existing[slotKey(h)].type });
    updates[`settings/availabilityOverrides/${date}/${slotKey(h)}`] = null;
  }
  const [ap, av] = auditEntry(actorRef(actor), 'OVERRIDE_REMOVED', {
    details: { date, removed, reason: str(request.data?.reason, 500) || null },
  });
  updates[ap] = av;
  await db.ref().update(updates);
  return { ok: true };
});

// ---- Holidays ---------------------------------------------------------------------
async function activeBookingsOn(date) {
  const day = (await db.ref(`bookingSlots/${date}`).get()).val() || {};
  return Object.values(day).filter((s) => isSlotOccupied(s) && ACTIVE_STATUSES.includes(s.status));
}

export const setHoliday = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, BOOKING_STAFF_ROLES, 'Only Staff Admin can manage holidays.');
  const d = request.data || {};
  const date = str(d.date, 10);
  if (!isValidDateStr(date)) fail('invalid-argument', 'Invalid date.');
  const name = str(d.name, 120) || 'Public Holiday';
  const open = d.open === true;
  const ref = db.ref(`settings/holidays/${date}`);
  const previous = (await ref.get()).val();

  const record = {
    name,
    open,
    requiresSpecial: open && d.requiresSpecial === true,
    remarks: str(d.remarks, 500) || null,
    updatedBy: actor.name,
    updatedByUid: actor.uid,
    updatedAt: TS,
    createdAt: previous?.createdAt || Date.now(),
  };
  if (open && !previous?.open) Object.assign(record, { openedBy: actor.name, openedByUid: actor.uid, openedAt: Date.now() });
  await ref.set(record);

  // Closing a date is only allowed when nothing is booked on it (write, check, undo).
  if (!open) {
    const active = await activeBookingsOn(date);
    if (active.length) {
      if (previous) await ref.set(previous);
      else await ref.remove();
      fail('failed-precondition', `There ${active.length === 1 ? 'is an active booking' : 'are active bookings'} on this date. Cancel them before closing the date.`);
    }
  }
  const action = !previous ? 'HOLIDAY_ADDED' : open && !previous.open ? 'HOLIDAY_OPENED' : !open && previous.open ? 'HOLIDAY_CLOSED' : 'HOLIDAY_UPDATED';
  const [ap, av] = auditEntry(actorRef(actor), action, { details: { date, name, open, requiresSpecial: record.requiresSpecial } });
  await db.ref(ap).set(av);
  return { ok: true };
});

export const removeHoliday = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, BOOKING_STAFF_ROLES);
  const date = str(request.data?.date, 10);
  if (!isValidDateStr(date)) fail('invalid-argument', 'Invalid date.');
  const previous = (await db.ref(`settings/holidays/${date}`).get()).val();
  if (!previous) return { ok: true };
  const [ap, av] = auditEntry(actorRef(actor), 'HOLIDAY_REMOVED', { details: { date, name: previous.name } });
  await db.ref().update({ [`settings/holidays/${date}`]: null, [ap]: av });
  return { ok: true };
});

// ---- Student management -------------------------------------------------------
export const updateStudent = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, BOOKING_STAFF_ROLES, 'Only Staff Admin can edit student records.');
  const d = request.data || {};
  const key = niftKey(d.niftId);
  const reg = (await db.ref(`students/${key}`).get()).val();
  if (!reg?.uid) fail('not-found', 'Student not found.');
  const user = (await db.ref(`users/${reg.uid}`).get()).val();
  if (!user) fail('not-found', 'Student profile not found.');

  const next = {
    name: d.name !== undefined ? str(d.name, 100) : user.name,
    phone: d.phone !== undefined ? str(d.phone, 20) : user.phone,
    department: d.department !== undefined ? String(d.department).toUpperCase() : user.department,
    semester: d.semester !== undefined ? Number(d.semester) : Number(user.semester),
    studentType: d.studentType !== undefined ? d.studentType : user.studentType,
    status: d.status !== undefined ? d.status : user.status,
  };
  if (next.name.length < 3) fail('invalid-argument', 'Invalid name.');
  if (!isPhone(next.phone)) fail('invalid-argument', 'Invalid phone number.');
  if (!DEPARTMENTS.includes(next.department)) fail('invalid-argument', 'Invalid department.');
  if (!isValidSemester(next.department, next.semester)) fail('invalid-argument', 'Invalid semester for this department.');
  if (!Object.values(STUDENT_TYPES).includes(next.studentType)) fail('invalid-argument', 'Invalid student type.');
  if (!Object.values(ACCOUNT_STATUS).includes(next.status)) fail('invalid-argument', 'Invalid account status.');
  next.bookingAccess = next.status === ACCOUNT_STATUS.ACTIVE;

  const changes = {};
  for (const k of Object.keys(next)) if (next[k] !== user[k]) changes[k] = { from: user[k] ?? null, to: next[k] };
  if (!Object.keys(changes).length) return { ok: true, changed: false };

  const by = actorRef(actor);
  const updates = {};
  for (const [k, v] of Object.entries(next)) updates[`users/${reg.uid}/${k}`] = v;
  updates[`users/${reg.uid}/updatedAt`] = TS;
  for (const k of ['name', 'department', 'semester', 'studentType', 'status']) updates[`students/${key}/${k}`] = next[k];
  const action = changes.studentType
    ? 'STUDENT_CLASSIFICATION_CHANGED'
    : changes.status?.to === ACCOUNT_STATUS.GRADUATED
      ? 'GRADUATION'
      : changes.semester
        ? 'SEMESTER_UPDATE'
        : 'STUDENT_UPDATED';
  const [ap, av] = auditEntry(by, action, { niftId: user.niftId, details: { changes, remarks: str(d.remarks, 500) || null } });
  updates[ap] = av;
  await db.ref().update(updates);
  return { ok: true, changed: true };
});

// ---- Admin & role management (Main Admin) ------------------------------------
export const setAdminRole = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, [ROLES.MAIN], 'Only the Main Admin can manage admins.');
  const email = str(request.data?.email, 160).toLowerCase();
  const role = request.data?.role || null;
  if (!isValidEmail(email) || !isAllowedEmail(email)) fail('invalid-argument', 'Enter a valid NIFT email address.');
  if (role && !ADMIN_ROLES.includes(role)) fail('invalid-argument', 'Invalid role.');

  let uid = null;
  try {
    uid = (await getAuth().getUserByEmail(email)).uid;
  } catch {
    uid = null;
  }

  if (!role && uid === actor.uid) {
    const admins = (await db.ref('admins').get()).val() || {};
    const mains = Object.values(admins).filter((a) => a.role === ROLES.MAIN);
    if (mains.length <= 1) fail('failed-precondition', 'You are the last Main Admin and cannot remove yourself.');
  }

  const updates = {};
  if (uid) {
    if (role) {
      updates[`roles/${uid}`] = { role, email, assignedAt: TS, assignedBy: actor.name };
      updates[`admins/${uid}`] = { email, role, name: (await db.ref(`admins/${uid}/name`).get()).val() || email, addedAt: TS, addedBy: actor.name };
    } else {
      updates[`roles/${uid}`] = null;
      updates[`admins/${uid}`] = null;
    }
    updates[`adminInvites/${emailKey(email)}`] = null;
  } else {
    updates[`adminInvites/${emailKey(email)}`] = role
      ? { email, role, invitedBy: actor.uid, invitedByName: actor.name, at: TS }
      : null;
  }
  const [ap, av] = auditEntry(actorRef(actor), role ? 'ROLE_ASSIGNED' : 'ROLE_REMOVED', {
    details: { email, role, pendingInvite: !uid },
  });
  updates[ap] = av;
  await db.ref().update(updates);
  return { ok: true, pending: !uid };
});

// ---- Settings (Main Admin) ------------------------------------------------------
const intIn = (v, lo, hi, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) fail('invalid-argument', `${label} must be a whole number between ${lo} and ${hi}.`);
  return n;
};
const days = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number))].filter((n) => n >= 0 && n <= 6).sort();
const mmdd = (v, label) => {
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(v))) fail('invalid-argument', `${label} must be in MM-DD format.`);
  return String(v);
};
const idOk = (id) => /^[A-Za-z][\w-]{1,40}$/.test(id);

function cleanItems(obj, shape, what) {
  if (!obj || typeof obj !== 'object') fail('invalid-argument', `Invalid ${what}.`);
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    if (!idOk(id)) fail('invalid-argument', `Invalid ${what} id "${id}".`);
    out[id] = shape(v || {}, id);
  }
  return out;
}

const SETTINGS_VALIDATORS = {
  bookingRules(v) {
    const r = {
      gridStartHour: intIn(v.gridStartHour, 0, 23, 'Calendar start hour'),
      gridEndHour: intIn(v.gridEndHour, 1, 24, 'Calendar end hour'),
      classDays: days(v.classDays),
      classStartHour: intIn(v.classStartHour, 0, 23, 'Class start'),
      classEndHour: intIn(v.classEndHour, 1, 24, 'Class end'),
      classLabel: str(v.classLabel, 40) || 'CLS CLASS',
      regularStartHour: intIn(v.regularStartHour, 0, 23, 'Regular start'),
      regularEndHour: intIn(v.regularEndHour, 1, 24, 'Regular end'),
      afterHoursEnabled: v.afterHoursEnabled === true,
      weekendDays: days(v.weekendDays),
      weekendBookingEnabled: v.weekendBookingEnabled === true,
      weekendStartHour: intIn(v.weekendStartHour, 0, 23, 'Weekend start'),
      holidayOpenStartHour: intIn(v.holidayOpenStartHour, 0, 23, 'Holiday start'),
      bookingWindowDays: intIn(v.bookingWindowDays, 1, 7, 'Student booking window'),
      staffBookingWindowDays: intIn(v.staffBookingWindowDays, 1, 120, 'Staff booking window'),
      maxDurationHours: intIn(v.maxDurationHours, 1, 4, 'Maximum hours (other students)'),
      fcMaxDurationHours: intIn(v.fcMaxDurationHours ?? 4, 1, 6, 'Maximum hours (FC students)'),
      firstYearMaxSemester: intIn(v.firstYearMaxSemester, 0, 2, 'First-year semesters'),
      seniorMinSemester: intIn(v.seniorMinSemester, 2, 8, 'Senior minimum semester'),
      firstYearMessage: str(v.firstYearMessage, 500),
      otherDeptRequiresFcStudent: v.otherDeptRequiresFcStudent === true,
      fcIdmRequiresFcApproval: v.fcIdmRequiresFcApproval === true,
      fcApproverTypes: (Array.isArray(v.fcApproverTypes) ? v.fcApproverTypes : [STUDENT_TYPES.FC]).filter((t) =>
        [STUDENT_TYPES.FC, STUDENT_TYPES.FC_IDM].includes(t),
      ),
      otherDeptNoticeEnabled: v.otherDeptNoticeEnabled === true,
      otherDeptNotice: str(v.otherDeptNotice, 500),
      specialHoursMessage: str(v.specialHoursMessage, 500),
      facultyEmailRequired: v.facultyEmailRequired === true,
      facultyEmailDomains: (Array.isArray(v.facultyEmailDomains) ? v.facultyEmailDomains : ['nift.ac.in'])
        .map((x) => str(x, 60).toLowerCase())
        .filter(Boolean),
      studentCanCancel: v.studentCanCancel === true,
    };
    if (r.gridEndHour <= r.gridStartHour) fail('invalid-argument', 'Calendar end must be after start.');
    if (r.classEndHour <= r.classStartHour) fail('invalid-argument', 'Class end must be after class start.');
    if (r.regularEndHour <= r.regularStartHour) fail('invalid-argument', 'Regular end must be after regular start.');
    if (!r.fcApproverTypes.length) r.fcApproverTypes = [STUDENT_TYPES.FC];
    if (!r.facultyEmailDomains.length) r.facultyEmailDomains = ['nift.ac.in'];
    return r;
  },
  questions(v) {
    return cleanItems(v, (q) => ({
      label: str(q.label, 300) || fail('invalid-argument', 'Every question needs a label.'),
      type: ['text', 'textarea', 'number', 'select', 'checkbox'].includes(q.type) ? q.type : 'text',
      options: str(q.options, 1000),
      helpText: str(q.helpText, 300),
      defaultValue: q.type === 'number' && q.defaultValue !== '' && q.defaultValue !== undefined && Number.isFinite(Number(q.defaultValue)) ? Number(q.defaultValue) : null,
      required: q.required === true,
      enabled: q.enabled !== false,
      order: Number(q.order) || 0,
    }), 'question');
  },
  declaration(v) {
    return {
      title: str(v.title, 120) || 'Declaration',
      text: str(v.text, 5000),
      confirmations: cleanItems(v.confirmations || {}, (c) => ({
        label: str(c.label, 300) || fail('invalid-argument', 'Every confirmation needs a label.'),
        required: c.required === true,
        enabled: c.enabled !== false,
        order: Number(c.order) || 0,
      }), 'confirmation'),
    };
  },
  instructions(v) {
    return { text: str(v.text, 5000) };
  },
  academicCalendar(v) {
    return {
      autoProgression: v.autoProgression === true,
      oddToEvenDate: mmdd(v.oddToEvenDate, 'Odd → Even date'),
      graduationDate: mmdd(v.graduationDate, 'Graduation date'),
      evenToOddDate: mmdd(v.evenToOddDate, 'Even → Odd date'),
      catchUpDays: intIn(v.catchUpDays ?? 14, 0, 60, 'Catch-up window'),
    };
  },
  equipment(v) {
    return cleanItems(v, (e) => ({
      name: str(e.name, 80) || fail('invalid-argument', 'Every equipment item needs a name.'),
      enabled: e.enabled !== false,
      order: Number(e.order) || 0,
      requiresReason: e.requiresReason === true,
      reasonLabel: str(e.reasonLabel, 200),
      otherDeptBringOwn: e.otherDeptBringOwn === true,
    }), 'equipment');
  },
};

export const saveSettings = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, [ROLES.MAIN], 'Only the Main Admin can change system settings.');
  const { section, value } = request.data || {};
  const validate = SETTINGS_VALIDATORS[section];
  if (!validate) fail('invalid-argument', 'Unknown settings section.');
  const clean = validate(value || {});
  const path = section === 'equipment' ? 'equipment' : `settings/${section}`;
  if (section === 'academicCalendar') {
    const lastRuns = (await db.ref('settings/academicCalendar/lastRuns').get()).val();
    if (lastRuns) clean.lastRuns = lastRuns;
  }
  const [ap, av] = auditEntry(actorRef(actor), 'SETTINGS_UPDATED', { details: { section } });
  await db.ref().update({ [path]: clean, [ap]: av });
  return { ok: true };
});

export const runSemesterProgression = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, [ROLES.MAIN], 'Only the Main Admin can run semester progression.');
  const event = request.data?.event;
  if (!Object.values(PROGRESSION_EVENTS).includes(event)) fail('invalid-argument', 'Unknown progression event.');
  return applyProgression(event, actorRef(actor), { dryRun: request.data?.dryRun !== false });
});
