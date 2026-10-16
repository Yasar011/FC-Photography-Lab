// Booking creation, cancellation and admin decisions.
import crypto from 'node:crypto';
import { onCall } from 'firebase-functions/v2/https';

import {
  db,
  bucket,
  fail,
  getActor,
  requireRole,
  loadSettings,
  auditEntry,
  actorRef,
  str,
  ADMIN_ROLES,
  BOOKING_STAFF_ROLES,

} from './core.js';
import { SMTP_PASS, sendAll, adminEmails, appLink } from './mail.js';
import { decodeSignature } from './signatures.js';
import * as N from './notify.js';
import {
  SLOT_TAKEN_MSG,
  addHistory,
  mutateBooking,
  syncSlots,
  logApproval,
  findStudent,
  accountBlockReason,

} from './bookingCore.js';
import {
  STATUS,
  STATUS_META,
  ACTIVE_STATUSES,
  STUDENT_TYPES,
  STUDENT_TYPE_LABELS,
  FC_APPROVAL_STATE,
  ACCOUNT_STATUS,
  isValidSemester,
  isValidEmail,
  isAllowedEmail,
  niftKey,
} from '../shared/constants.js';
import {
  evaluateRange,
  specialReasons,
  isSlotOccupied,
  slotKey,
  slotStartMs,
  todayIST,
  bookingIdFor,
  formatRange,
} from '../shared/calendar.js';
import { sortedEntries, maxHoursFor, needsAssistantApproval } from '../shared/defaults.js';

export const CALL_OPTS = { secrets: [SMTP_PASS] };

async function nextBookingId() {
  const today = todayIST();
  const res = await db.ref(`counters/bookingIds/${today.replace(/-/g, '')}`).transaction((n) => (n || 0) + 1);
  return bookingIdFor(today, res.snapshot.val());
}

function needsFcApproval(studentType, rules) {
  if (studentType === STUDENT_TYPES.OTHER) return Boolean(rules.otherDeptRequiresFcStudent);
  if (studentType === STUDENT_TYPES.FC_IDM) return Boolean(rules.fcIdmRequiresFcApproval);
  return false; // FC students never need FC approval
}

/** Validate questionnaire answers against admin-configured questions. */
function collectAnswers(questions, input = {}) {
  const answers = {};
  for (const q of sortedEntries(questions)) {
    if (!q.enabled) continue;
    let v = input[q.id];
    if (q.type === 'checkbox') v = v === true;
    else if (q.type === 'number') v = v === '' || v === null || v === undefined ? '' : Number(v);
    else v = str(v, 2000);
    const empty = v === '' || v === false || (typeof v === 'number' && Number.isNaN(v));
    if (q.required && empty) fail('invalid-argument', `Please answer: ${q.label}`);
    if (q.type === 'number' && !empty && (!Number.isFinite(v) || v < 0)) {
      fail('invalid-argument', `Please enter a valid number for: ${q.label}`);
    }
    if (q.type === 'select' && !empty) {
      const options = String(q.options || '').split(',').map((o) => o.trim()).filter(Boolean);
      if (!options.includes(v)) fail('invalid-argument', `Invalid option for: ${q.label}`);
    }
    if (!empty) answers[q.id] = { label: q.label, value: v };
  }
  return answers;
}

// ---- createBooking ------------------------------------------------------------
export const createBooking = onCall(CALL_OPTS, async (request) => {
  const actor = await getActor(request);
  const data = request.data || {};
  const settings = await loadSettings();
  const rules = settings.bookingRules;
  const staffBooking = Boolean(data.onBehalfOfNiftId);

  // 1–6. Who is booking, and are they eligible?
  let studentUid;
  let student;
  if (staffBooking) {
    requireRole(actor, BOOKING_STAFF_ROLES, 'Only Staff Admin can create bookings for students.');
    const found = await findStudent(data.onBehalfOfNiftId);
    if (!found) fail('not-found', 'No registered student with this NIFT ID.');
    ({ uid: studentUid, user: student } = found);
  } else {
    if (!actor.profile?.niftId) fail('failed-precondition', 'Please complete your registration first.');
    studentUid = actor.uid;
    student = actor.profile;
  }
  const blocked = accountBlockReason(student);
  if (blocked) fail('failed-precondition', blocked);
  if (!isValidSemester(student.department, student.semester)) {
    fail('failed-precondition', 'Your semester/department record is invalid. Please contact the FC Staff.');
  }
  const reg = (await db.ref(`students/${niftKey(student.niftId)}`).get()).val();
  if (reg?.uid !== studentUid) fail('failed-precondition', 'NIFT ID record mismatch. Please contact the FC Staff.');

  // 7–11. Date, time, duration, availability.
  const date = str(data.date, 10);
  const startHour = Number(data.startHour);
  const endHour = Number(data.endHour);
  const [holidaySnap, overridesSnap, slotsSnap] = await Promise.all([
    db.ref(`settings/holidays/${date}`).get(),
    db.ref(`settings/availabilityOverrides/${date}`).get(),
    db.ref(`bookingSlots/${date}`).get(),
  ]);
  const holiday = holidaySnap.val();
  const overrides = overridesSnap.val() || {};
  const slots = slotsSnap.val() || {};
  const range = evaluateRange({
    date, startHour, endHour, rules, holiday, overrides, slots, nowMs: Date.now(), staff: staffBooking,
    maxHours: maxHoursFor(rules, student.studentType), // FC students 4 h, others 3 h
  });
  if (!range.ok) {
    const taken = range.states.some((s) => s.bookingId);
    if (taken) fail('already-exists', SLOT_TAKEN_MSG);
    fail('failed-precondition', range.errors.join(' '));
  }
  const isSpecial = range.requiresSpecial;

  // First-year rule.
  let senior = null;
  if (Number(student.semester) <= rules.firstYearMaxSemester) {
    if (!data.seniorNiftId) fail('failed-precondition', `${rules.firstYearMessage} Please add the senior student.`);
    const s = await findStudent(data.seniorNiftId);
    if (!s) fail('not-found', 'Senior student not found. They must be registered in this system.');
    if (s.uid === studentUid) fail('invalid-argument', 'You cannot list yourself as the senior student.');
    if (s.user.status !== ACCOUNT_STATUS.ACTIVE) fail('failed-precondition', 'The senior student account is not active.');
    if (Number(s.user.semester) < rules.seniorMinSemester) {
      fail('failed-precondition', `The senior student must be in Semester ${rules.seniorMinSemester} or above.`);
    }
    senior = {
      uid: s.uid, niftId: s.user.niftId, name: s.user.name, department: s.user.department,
      semester: s.user.semester, email: s.user.email,
    };
  }

  // 12. FC student involvement.
  const requiresFcApproval = needsFcApproval(student.studentType, rules);
  let fcStudent = null;
  if (requiresFcApproval) {
    if (!data.fcStudentNiftId) fail('failed-precondition', 'Please select the FC student involved in this booking.');
    const f = await findStudent(data.fcStudentNiftId);
    if (!f) fail('not-found', 'FC student not found. They must be registered in this system.');
    if (f.uid === studentUid) fail('invalid-argument', 'You cannot approve your own booking.');
    if (!(rules.fcApproverTypes || [STUDENT_TYPES.FC]).includes(f.user.studentType)) {
      fail('failed-precondition', `${f.user.name} is not classified as an FC student.`);
    }
    if (f.user.status !== ACCOUNT_STATUS.ACTIVE) fail('failed-precondition', 'The selected FC student account is not active.');
    fcStudent = {
      uid: f.uid, niftId: f.user.niftId, name: f.user.name, department: f.user.department,
      semester: f.user.semester, email: f.user.email,
    };
  }

  // 13. Required information.
  const purpose = str(data.purpose, 500);
  if (purpose.length < 3) fail('invalid-argument', 'Please describe the purpose of the booking.');

  const equipment = {};
  const equipmentList = [];
  const equipmentReasons = {};
  let bringOwnNeeded = false;
  for (const id of Array.isArray(data.equipment) ? data.equipment : []) {
    const item = settings.equipment?.[id];
    if (!item || !item.enabled || equipment[id]) continue;
    equipment[id] = true;
    equipmentList.push(item.name);
    if (item.requiresReason) {
      const reason = str(data.equipmentReasons?.[id], 1000);
      if (reason.length < 3) fail('invalid-argument', item.reasonLabel || `Please explain why you need ${item.name}.`);
      equipmentReasons[id] = { label: item.reasonLabel || item.name, value: reason };
    }
    if (item.otherDeptBringOwn) bringOwnNeeded = true;
  }
  if (!equipmentList.length) fail('invalid-argument', 'Please select at least one requirement.');
  const isOtherDept = student.studentType === STUDENT_TYPES.OTHER;
  if (isOtherDept && bringOwnNeeded && rules.otherDeptNoticeEnabled && data.bringOwnAck !== true) {
    fail('failed-precondition', rules.otherDeptNotice);
  }

  const answers = collectAnswers(settings.questions, data.answers);

  const facultyName = str(data.facultyName, 120);
  const facultyEmail = str(data.facultyEmail, 160).toLowerCase();
  if (rules.facultyEmailRequired && !facultyEmail) fail('invalid-argument', 'Faculty email is required.');
  if (facultyEmail) {
    if (!isValidEmail(facultyEmail)) fail('invalid-argument', 'Please enter a valid faculty email.');
    if (!isAllowedEmail(facultyEmail, rules.facultyEmailDomains)) {
      fail('invalid-argument', `Faculty email must be an official address (${rules.facultyEmailDomains.join(', ')}).`);
    }
    if (!facultyName) fail('invalid-argument', 'Please enter the subject/faculty name.');
  }

  // 14. Declaration & signature.
  const confirmations = {};
  for (const c of sortedEntries(settings.declaration?.confirmations)) {
    if (!c.enabled) continue;
    const checked = data.confirmations?.[c.id] === true;
    if (c.required && !checked) fail('invalid-argument', `Please confirm: ${c.label}`);
    confirmations[c.id] = { label: c.label, checked };
  }
  const signatureBuf = decodeSignature(data.signature);
  const remarks = staffBooking ? str(data.remarks, 1000) : '';

  // 10–11. Atomically claim every hour — only one request can win.
  const id = await nextBookingId();
  const hours = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);
  const lock = await db.ref(`bookingSlots/${date}`).transaction((cur) => {
    const day = cur || {};
    for (const h of hours) if (isSlotOccupied(day[slotKey(h)])) return undefined;
    for (const h of hours) day[slotKey(h)] = { bookingId: id, status: STATUS.SUBMITTED, uid: studentUid };
    return day;
  });
  if (!lock.committed) fail('already-exists', SLOT_TAKEN_MSG);

  const release = () =>
    syncSlots({ id, date, startHour, endHour, status: STATUS.CANCELLED_BY_ADMIN }).catch(() => {});

  // A block / holiday closure made concurrently by staff wins over this new
  // claim: re-check the calendar rules now that the slots are held.
  const [latestHoliday, latestOverrides] = await Promise.all([
    db.ref(`settings/holidays/${date}`).get(),
    db.ref(`settings/availabilityOverrides/${date}`).get(),
  ]);
  const recheck = evaluateRange({
    date, startHour, endHour, rules, holiday: latestHoliday.val(),
    overrides: latestOverrides.val() || {}, slots: {}, nowMs: Date.now(), staff: staffBooking,
    maxHours: maxHoursFor(rules, student.studentType),
  });
  if (!recheck.ok || recheck.requiresSpecial !== isSpecial) {
    await release();
    fail('failed-precondition', 'The FC Staff just changed availability for this time. Please select the slot again.');
  }

  const signaturePath = `signatures/${id}.png`;
  try {
    await bucket().file(signaturePath).save(signatureBuf, {
      contentType: 'image/png',
      resumable: false,
      metadata: { metadata: { bookingId: id, niftId: student.niftId, uid: studentUid } },
    });
  } catch (err) {
    await release();
    fail('internal', 'Could not save your signature. Please try again.');
  }

  // 15. Workflow.
  const now = Date.now();
  const by = actorRef(actor);
  const booking = {
    id,
    studentUid,
    studentName: student.name,
    niftId: student.niftId,
    email: student.email,
    department: student.department,
    semester: Number(student.semester),
    studentType: student.studentType,
    phone: student.phone || '',
    date,
    startHour,
    endHour,
    duration: endHour - startHour,
    startAt: slotStartMs(date, startHour),
    endAt: slotStartMs(date, endHour),
    purpose,
    equipment,
    equipmentList,
    equipmentReasons,
    clsReason: equipmentReasons.clsRoom?.value || '',
    bringOwnAck: data.bringOwnAck === true,
    answers,
    requiresFcApproval,
    fcStudent,
    fcStudentUid: fcStudent?.uid || null,
    senior,
    seniorUid: senior?.uid || null,
    faculty: facultyEmail ? { name: facultyName, email: facultyEmail } : null,
    isSpecial,
    specialReasons: isSpecial ? specialReasons({ date, startHour, endHour, rules, holiday, overrides }) : [],
    special: isSpecial ? { required: true, steps: {} } : null,
    usesOverride: range.usesOverride,
    // Normal bookings: FC Lab Assistant approves in the portal (printing optional).
    // Staff-made bookings are already reviewed by the FC staff — no second approval.
    assistantApprovalRequired: !isSpecial && !staffBooking && needsAssistantApproval(rules, student.studentType),
    signature: {
      path: signaturePath,
      signerName: student.name,
      signerNiftId: student.niftId,
      signedAt: now,
      signedBy: staffBooking ? `${actor.name} (Staff, on behalf of student)` : student.name,
    },
    declaration: {
      title: settings.declaration?.title || 'Declaration',
      text: settings.declaration?.text || '',
      confirmations,
      acceptedAt: now,
    },
    bookedByStaff: staffBooking,
    createdBy: { type: staffBooking ? 'staff' : 'student', uid: actor.uid, name: actor.name, role: by.role },
    remarks: remarks || null,
    createdAt: now,
    updatedAt: now,
    status: STATUS.SUBMITTED,
  };
  addHistory(booking, {
    status: STATUS.SUBMITTED,
    event: 'BOOKING SUBMITTED',
    actor: by,
    note: staffBooking ? 'Booked by: Staff Admin' : null,
    at: now,
  });

  const updates = {};
  let fcApprovalId = null;
  if (requiresFcApproval) {
    fcApprovalId = db.ref('fcApprovals').push().key;
    booking.status = STATUS.PENDING_FC_APPROVAL;
    booking.fcApprovalId = fcApprovalId;
    addHistory(booking, { status: booking.status, event: 'FC APPROVAL REQUESTED', actor: by, note: `Requested from ${fcStudent.name} (${fcStudent.niftId})`, at: now + 1 });
    updates[`fcApprovals/${fcApprovalId}`] = {
      id: fcApprovalId,
      bookingId: id,
      fcStudentUid: fcStudent.uid,
      fcStudentNiftId: fcStudent.niftId,
      fcStudentName: fcStudent.name,
      requesterUid: studentUid,
      requester: {
        name: student.name, niftId: student.niftId, department: student.department,
        semester: Number(student.semester), studentType: student.studentType,
      },
      date, startHour, endHour, purpose, equipmentList,
      isSpecial,
      state: FC_APPROVAL_STATE.PENDING,
      createdAt: now,
    };
  } else if (isSpecial) {
    booking.status = STATUS.PENDING_SPECIAL_APPROVAL;
    addHistory(booking, { status: booking.status, event: 'SPECIAL APPROVAL REQUIRED', actor: by, note: booking.specialReasons.join(', '), at: now + 1 });
  } else if (booking.assistantApprovalRequired) {
    booking.status = STATUS.PENDING_ASSISTANT_APPROVAL;
    addHistory(booking, { status: booking.status, event: 'SENT TO FC LAB ASSISTANT FOR APPROVAL', actor: by, at: now + 1 });
  } else {
    booking.status = STATUS.APPROVED;
    addHistory(booking, { status: booking.status, event: 'APPROVED', actor: { name: 'System', uid: 'system', role: 'system' }, note: 'All booking rules satisfied.', at: now + 1 });
  }

  let facultyToken = null;
  if (booking.faculty) {
    facultyToken = crypto.randomBytes(24).toString('base64url');
    booking.facultyNotificationId = id;
    updates[`facultyNotifications/${id}`] = {
      bookingId: id,
      facultyName,
      facultyEmail,
      tokenHash: crypto.createHash('sha256').update(facultyToken).digest('hex'),
      sentAt: now,
      response: null,
    };
  }

  updates[`bookings/${id}`] = booking;
  for (const h of hours) updates[`bookingSlots/${date}/${slotKey(h)}/status`] = booking.status;
  const action = staffBooking ? 'STAFF_BOOKING_CREATED' : 'BOOKING_CREATED';
  const [ap, av] = auditEntry(by, action, {
    bookingId: id,
    niftId: student.niftId,
    details: { date, time: formatRange(startHour, endHour), status: booking.status, usesOverride: range.usesOverride },
  });
  updates[ap] = av;

  try {
    await db.ref().update(updates);
  } catch (err) {
    await release();
    throw err;
  }

  // Notifications (never block the booking).
  const emails = [];
  if (staffBooking) emails.push(N.staffCreatedEmail(booking));
  else if (booking.status === STATUS.APPROVED) emails.push(N.approvedEmail(booking, 'booking.create'));
  else emails.push(N.submittedEmail(booking));
  if (fcApprovalId) emails.push(N.fcRequestEmail(booking, fcApprovalId, fcStudent.email));
  if (booking.status === STATUS.PENDING_SPECIAL_APPROVAL) {
    emails.push(N.specialRequiredEmail(booking, booking.email));
    emails.push(N.specialRequiredEmail(booking, await adminEmails(['staff', 'fccc']), true));
  }
  if (booking.faculty) {
    emails.push(N.facultyEmail(booking, appLink(`/faculty/${id}?t=${facultyToken}`)));
  }
  if (senior) emails.push(N.seniorEmail(booking));
  await sendAll(emails);

  return { bookingId: id, status: booking.status };
});

// ---- cancelBooking ------------------------------------------------------------
export const cancelBooking = onCall(CALL_OPTS, async (request) => {
  const actor = await getActor(request);
  const { bookingId } = request.data || {};
  const reason = str(request.data?.reason, 500);
  const settings = await loadSettings();
  const isAdmin = BOOKING_STAFF_ROLES.includes(actor.role);
  const by = actorRef(actor);

  const { after } = await mutateBooking(bookingId, (b) => {
    const isOwner = b.studentUid === actor.uid;
    if (!isOwner && !isAdmin) fail('permission-denied', 'You can only cancel your own bookings.');
    if (!ACTIVE_STATUSES.includes(b.status)) fail('failed-precondition', 'This booking can no longer be cancelled.');
    if (isOwner && !isAdmin) {
      if (!settings.bookingRules.studentCanCancel) fail('failed-precondition', 'Please contact the FC Staff to cancel.');
      if (b.startAt <= Date.now()) fail('failed-precondition', 'A booking that has already started cannot be cancelled.');
    }
    if (isAdmin && !isOwner && !reason) fail('invalid-argument', 'Please enter a reason for cancelling.');
    b.status = isOwner ? STATUS.CANCELLED_BY_STUDENT : STATUS.CANCELLED_BY_ADMIN;
    b.cancellation = { byUid: actor.uid, byName: actor.name, role: by.role, at: Date.now(), reason: reason || null };
    return addHistory(b, { event: STATUS_META[b.status].label.toUpperCase(), actor: by, note: reason });
  });

  await syncSlots(after);
  const updates = {};
  if (after.fcApprovalId) {
    const fa = (await db.ref(`fcApprovals/${after.fcApprovalId}/state`).get()).val();
    if (fa === FC_APPROVAL_STATE.PENDING) updates[`fcApprovals/${after.fcApprovalId}/state`] = FC_APPROVAL_STATE.CANCELLED;
  }
  const [ap, av] = auditEntry(by, 'BOOKING_CANCELLED', { bookingId: after.id, niftId: after.niftId, details: { status: after.status, reason } });
  updates[ap] = av;
  await db.ref().update(updates);

  const byLabel = after.status === STATUS.CANCELLED_BY_STUDENT ? 'the student' : `FC Staff (${actor.name})`;
  const to = [after.email];
  if (after.fcStudent?.email && updates[`fcApprovals/${after.fcApprovalId}/state`]) to.push(after.fcStudent.email);
  await sendAll([N.cancelledEmail(after, to, byLabel, reason)]);
  return { status: after.status };
});

// ---- Admin decisions (approve / reject a regular booking) ----------------------
export const adminBookingDecision = onCall(CALL_OPTS, async (request) => {
  const actor = await getActor(request);
  requireRole(actor, ADMIN_ROLES);
  const { bookingId, decision } = request.data || {};
  const remarks = str(request.data?.remarks, 1000);
  const by = actorRef(actor);
  if (!['approve', 'reject'].includes(decision)) fail('invalid-argument', 'Invalid decision.');

  // The FC Lab Assistant approves in the portal (recorded with name & time — no signature).
  const current = (await db.ref(`bookings/${bookingId}`).get()).val();
  if (!current) fail('not-found', 'Booking not found.');
  const assistantStep = decision === 'approve' && current.status === STATUS.PENDING_ASSISTANT_APPROVAL;

  const { after } = await mutateBooking(bookingId, (b) => {
    if (decision === 'reject') {
      if (!ACTIVE_STATUSES.includes(b.status)) fail('failed-precondition', 'Only active bookings can be rejected.');
      if (!remarks) fail('invalid-argument', 'Please enter a reason for rejection.');
      b.status = STATUS.REJECTED;
      b.rejection = { byUid: actor.uid, byName: actor.name, role: by.role, at: Date.now(), reason: remarks };
      return addHistory(b, { event: 'REJECTED', actor: by, note: remarks });
    }
    // Approval is only for bookings whose required approvals are complete.
    if (b.status === STATUS.PENDING_FC_APPROVAL) fail('failed-precondition', 'The FC student must approve this booking from their own account.');
    if (b.status === STATUS.PENDING_SPECIAL_APPROVAL) fail('failed-precondition', 'Use the special approval tracker to approve this booking.');
    if (b.status === STATUS.FACULTY_CONCERN) fail('failed-precondition', 'Resolve the faculty concern instead.');
    if (![STATUS.SUBMITTED, STATUS.FC_APPROVED, STATUS.PENDING_ASSISTANT_APPROVAL].includes(b.status)) fail('failed-precondition', 'This booking cannot be approved.');
    if (b.isSpecial && b.special?.steps?.final?.state !== 'approved') fail('failed-precondition', 'Special approval is not complete.');
    if (b.status === STATUS.PENDING_ASSISTANT_APPROVAL) {
      b.assistantApproval = { byUid: actor.uid, byName: actor.name, role: actor.role, at: Date.now(), remarks: remarks || null };
    }
    const event = b.status === STATUS.PENDING_ASSISTANT_APPROVAL ? 'APPROVED BY FC LAB ASSISTANT' : 'APPROVED';
    b.status = STATUS.APPROVED;
    return addHistory(b, { event, actor: by, note: remarks });
  });

  await syncSlots(after);
  if (after.status === STATUS.REJECTED && after.fcApprovalId) {
    const ref = db.ref(`fcApprovals/${after.fcApprovalId}/state`);
    if ((await ref.get()).val() === FC_APPROVAL_STATE.PENDING) await ref.set(FC_APPROVAL_STATE.CANCELLED);
  }
  await logApproval(by, {
    bookingId: after.id,
    kind: assistantStep ? 'fc_assistant' : 'admin',
    decision,
    remarks,
    auditAction: decision === 'approve' ? 'ADMIN_APPROVED' : 'ADMIN_REJECTED',
  });
  await sendAll([decision === 'approve' ? N.approvedEmail(after) : N.rejectedEmail(after, remarks)]);
  return { status: after.status };
});

// ---- Signature (served through the backend so Storage stays private) -----------
export const getSignature = onCall(async (request) => {
  const actor = await getActor(request);
  const bookingId = String(request.data?.bookingId || '');
  const b = (await db.ref(`bookings/${bookingId}`).get()).val();
  if (!b) fail('not-found', 'Booking not found.');
  const allowed = actor.role || b.studentUid === actor.uid || b.fcStudentUid === actor.uid;
  if (!allowed) fail('permission-denied', 'You cannot view this signature.');
  const [buf] = await bucket().file(b.signature.path).download();
  return { dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
});

// ---- Student search by name or NIFT ID (FC student / senior pickers) -------------
// Returns only eligible, active students and only public fields.
export const searchStudents = onCall(async (request) => {
  const actor = await getActor(request);
  const q = str(request.data?.query, 60).toLowerCase();
  const purpose = request.data?.purpose;
  if (q.length < 2) return { results: [] };
  const rules = (await loadSettings()).bookingRules;
  const all = (await db.ref('students').get()).val() || {};
  const results = [];
  for (const s of Object.values(all)) {
    if (!s?.uid || s.uid === actor.uid || s.status !== ACCOUNT_STATUS.ACTIVE) continue;
    if (purpose === 'fc' && !(rules.fcApproverTypes || [STUDENT_TYPES.FC]).includes(s.studentType)) continue;
    if (purpose === 'senior' && Number(s.semester) < rules.seniorMinSemester) continue;
    if (!String(s.name || '').toLowerCase().includes(q) && !String(s.niftId || '').toLowerCase().includes(q)) continue;
    results.push({
      name: s.name, niftId: s.niftId, department: s.department, semester: s.semester,
      studentType: s.studentType, studentTypeLabel: STUDENT_TYPE_LABELS[s.studentType] || s.studentType,
    });
    if (results.length >= 8) break;
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return { results };
});

// ---- Student lookup (minimal public info for FC / senior selection) ------------
export const lookupStudent = onCall(async (request) => {
  const actor = await getActor(request);
  const { niftId, purpose } = request.data || {};
  const settings = await loadSettings();
  const rules = settings.bookingRules;
  const found = await findStudent(niftId);
  if (!found) return { found: false };
  const u = found.user;
  let eligible = u.status === ACCOUNT_STATUS.ACTIVE;
  let reason = eligible ? '' : 'Account is not active.';
  if (found.uid === actor.uid && !actor.role) {
    eligible = false;
    reason = 'You cannot select yourself.';
  } else if (eligible && purpose === 'fc' && !(rules.fcApproverTypes || []).includes(u.studentType)) {
    eligible = false;
    reason = 'This student is not classified as an FC student.';
  } else if (eligible && purpose === 'senior' && Number(u.semester) < rules.seniorMinSemester) {
    eligible = false;
    reason = `Senior student must be in Semester ${rules.seniorMinSemester} or above.`;
  }
  return {
    found: true,
    eligible,
    reason,
    student: {
      name: u.name,
      niftId: u.niftId,
      department: u.department,
      semester: u.semester,
      studentType: u.studentType,
      studentTypeLabel: STUDENT_TYPE_LABELS[u.studentType] || u.studentType,
      ...(actor.role ? { status: u.status } : {}),
    },
  };
});
