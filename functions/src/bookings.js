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
import { SMTP_PASS, sendAll, adminEmails, appLink, requestDecision } from './mail.js';
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
  APPROVER_ROLES,
  isValidSemester,
  isValidEmail,
  isAllowedEmail,
  niftKey,
  digitalSignature,
  SLOT_HOLDING_STATUSES,
  approvalChain,
  statusAfter,
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
  formatDateTime,
  submissionProblem,
  startOfWeek,
  addDays,
  formatDate,
} from '../shared/calendar.js';
import { sortedEntries, maxHoursFor, activeBookingBlock } from '../shared/defaults.js';

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
  const recentCancel = activeBookingBlock(student);
  if (recentCancel && !staffBooking) {
    fail('failed-precondition', `As you cancelled booking ${recentCancel.bookingId}, you can't book until ${formatDateTime(recentCancel.until)}.`);
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

  // When students may book, and fair-use limits (staff bookings are exempt).
  if (!staffBooking) {
    const late = submissionProblem({ rules, nowMs: Date.now(), isSpecial, startAt: slotStartMs(date, startHour) });
    if (late) fail('failed-precondition', late);
    await checkUsageLimits({ studentUid, date, hours: endHour - startHour, rules, studentType: student.studentType });
  }

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
  const isOtherDept = student.studentType === STUDENT_TYPES.OTHER;
  for (const id of Array.isArray(data.equipment) ? data.equipment : []) {
    const item = settings.equipment?.[id];
    if (!item || !item.enabled || equipment[id]) continue;
    // Items like the FC camera are not issued to other-department students.
    if (isOtherDept && item.otherDeptBringOwn) {
      fail('failed-precondition', `${item.name} is not issued to students from other departments. ${rules.otherDeptNotice}`);
    }
    equipment[id] = true;
    equipmentList.push(item.name);
    if (item.requiresReason) {
      const reason = str(data.equipmentReasons?.[id], 1000);
      if (reason.length < 3) fail('invalid-argument', item.reasonLabel || `Please explain why you need ${item.name}.`);
      equipmentReasons[id] = { label: item.reasonLabel || item.name, value: reason };
    }
  }
  if (!equipmentList.length) fail('invalid-argument', 'Please select at least one requirement.');

  const answers = collectAnswers(settings.questions, data.answers);

  // Everyone using the lab — full name, department, hostel and room number (every booking).
  let participants = null;
  {
    const list = Array.isArray(data.participants) ? data.participants : [];
    const max = Number(rules.maxParticipants) || 30;
    if (!list.length) fail('invalid-argument', 'Please add every person who will use the lab (name, department, hostel and room).');
    if (list.length > max) fail('invalid-argument', `At most ${max} people can be listed.`);
    participants = list.map((p, i) => {
      const person = {
        name: str(p?.name, 100),
        department: str(p?.department, 40),
        hostel: str(p?.hostel, 80),
        room: str(p?.room, 20),
      };
      if (person.name.length < 3) fail('invalid-argument', `Person ${i + 1}: please enter the full name.`);
      if (!person.department) fail('invalid-argument', `Person ${i + 1}: please enter the department.`);
      if (!person.hostel) fail('invalid-argument', `Person ${i + 1}: please enter the hostel (or "Day scholar").`);
      if (!person.room) fail('invalid-argument', `Person ${i + 1}: please enter the room number (or "-").`);
      return person;
    });
    if (answers.q_team) answers.q_team.value = participants.length; // number of people = the list
  }

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
  // Digital signature = the student's explicit consent, stamped with name, NIFT ID and time.
  if (data.signDigitally !== true) fail('invalid-argument', 'Please tick “I sign this booking digitally”.');
  const remarks = staffBooking ? str(data.remarks, 1000) : '';

  // 10–11. Atomically claim every hour — only one request can win.
  const id = await nextBookingId();
  const hours = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);
  // Claim each hour atomically (lowest first). If any hour is already taken,
  // give back the hours claimed so far — two students can never both win.
  const claimed = [];
  const giveBack = () =>
    Promise.all(claimed.map((h) =>
      db.ref(`bookingSlots/${date}/${slotKey(h)}`).transaction((cur) => (cur?.bookingId === id ? null : cur)).catch(() => {}),
    ));
  for (const h of hours) {
    let res = null;
    try {
      res = await db.ref(`bookingSlots/${date}/${slotKey(h)}`).transaction((cur) =>
        isSlotOccupied(cur) ? undefined : { bookingId: id, status: STATUS.SUBMITTED, uid: studentUid });
    } catch {
      res = null;
    }
    if (!res?.committed || res.snapshot.val()?.bookingId !== id) {
      await giveBack();
      fail('already-exists', SLOT_TAKEN_MSG);
    }
    claimed.push(h);
  }

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
    bringsOwnCamera: isOtherDept, // other departments bring their own / department camera
    answers,
    participants,
    requiresFcApproval,
    fcStudent,
    fcStudentUid: fcStudent?.uid || null,
    senior,
    seniorUid: senior?.uid || null,
    faculty: facultyEmail ? { name: facultyName, email: facultyEmail } : null,
    isSpecial,
    specialReasons: isSpecial ? specialReasons({ date, startHour, endHour, rules, holiday, overrides }) : [],
    special: isSpecial ? { required: true } : null,
    usesOverride: range.usesOverride,
    // Normal bookings: FC Lab Assistant approves in the portal (printing optional).
    // Nothing is confirmed without the FC-CC: normal bookings go to the FC-CC,
    // special bookings end with the FC-CC's final approval.
    fcccApprovalRequired: true,
    signature: {
      ...digitalSignature({ name: student.name, id: student.niftId, role: 'Student', at: now, ref: id }),
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
  } else {
    // FC / FC-IDM students (normal or special) go straight to the FC-CC.
    booking.status = approvalChain(booking)[0].status;
    addHistory(booking, { status: booking.status, event: 'SENT TO FC-CC FOR APPROVAL', actor: by, at: now + 1 });
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
  if (booking.status === STATUS.PENDING_FCCC_APPROVAL) emails.push(N.fcccApprovalNeededEmail(booking, await adminEmails(['fccc', 'main'])));
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
  // Cancelling someone else's booking is an FC-CC decision too.
  const isAdmin = APPROVER_ROLES.includes(actor.role);
  const by = actorRef(actor);

  const { before, after } = await mutateBooking(bookingId, (b) => {
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
  // Cancelling your own APPROVED booking close to its start blocks new bookings
  // for a few days. Cancelling a pending booking, or cancelling early, does not.
  const cooldownDays = Number(settings.bookingRules.cancelCooldownDays) || 0;
  const withinMs = (Number(settings.bookingRules.cancelBlockWithinHours ?? 24) || 0) * 3600000;
  const lateCancel = before?.status === STATUS.APPROVED && after.startAt - Date.now() <= withinMs;
  let blockedUntil = null;
  if (after.status === STATUS.CANCELLED_BY_STUDENT && cooldownDays > 0 && lateCancel) {
    blockedUntil = Date.now() + cooldownDays * 86400000;
    updates[`users/${after.studentUid}/bookingBlock`] = { until: blockedUntil, bookingId: after.id, at: Date.now(), days: cooldownDays };
    const [bp, bv] = auditEntry(by, 'BOOKING_BLOCK_STARTED', { bookingId: after.id, niftId: after.niftId, details: { until: blockedUntil, days: cooldownDays } });
    updates[bp] = bv;
  }
  await db.ref().update(updates);

  const byLabel = after.status === STATUS.CANCELLED_BY_STUDENT ? 'the student' : `FC Staff (${actor.name})`;
  const to = [after.email];
  if (after.fcStudent?.email && updates[`fcApprovals/${after.fcApprovalId}/state`]) to.push(after.fcStudent.email);
  const emails = [N.cancelledEmail(after, to, byLabel, reason, blockedUntil)];
  // The institute admin was told it was approved — tell them it is off.
  if (before?.status === STATUS.APPROVED) emails.push(N.adminCancelledNoticeEmail(after, settings.bookingRules.approvalNotifyEmails, byLabel, reason));
  await sendAll(emails);
  return { status: after.status, blockedUntil };
});

/**
 * Fair use: total hours per day (FC 4 h, others 3 h — so two bookings can't
 * add up to more) and a weekly cap on bookings / hours (Monday–Sunday).
 */
async function checkUsageLimits({ studentUid, date, hours, rules, studentType }) {
  const snap = await db.ref('bookings').orderByChild('studentUid').equalTo(studentUid).get();
  const mine = Object.values(snap.val() || {}).filter((b) => SLOT_HOLDING_STATUSES.includes(b.status));
  const maxDay = maxHoursFor(rules, studentType);
  const dayHours = mine.filter((b) => b.date === date).reduce((h, b) => h + (Number(b.duration) || 0), 0);
  if (dayHours + hours > maxDay) {
    fail('failed-precondition', `You can book at most ${maxDay} hours a day. You already have ${dayHours} h on ${formatDate(date, { weekday: true })}.`);
  }
  const from = startOfWeek(date);
  const to = addDays(from, 6);
  const week = mine.filter((b) => b.date >= from && b.date <= to);
  const maxBookings = Number(rules.weeklyMaxBookings) || 0;
  const maxHours = Number(rules.weeklyMaxHours) || 0;
  if (maxBookings && week.length + 1 > maxBookings) {
    fail('failed-precondition', `You can make at most ${maxBookings} bookings a week (Mon–Sun). You already have ${week.length} in the week of ${formatDate(from)}.`);
  }
  const weekHours = week.reduce((h, b) => h + (Number(b.duration) || 0), 0);
  if (maxHours && weekHours + hours > maxHours) {
    fail('failed-precondition', `You can book at most ${maxHours} hours a week (Mon–Sun). You already have ${weekHours} h in the week of ${formatDate(from)}.`);
  }
}

// ---- Admin decisions (approve / reject a regular booking) ----------------------
export const adminBookingDecision = onCall(CALL_OPTS, async (request) => {
  const actor = await getActor(request);
  // Approve AND reject are FC-CC decisions; the FC Lab Assistant only mediates.
  requireRole(actor, APPROVER_ROLES, 'Only the FC-CC can approve or reject bookings.');
  const { bookingId, decision } = request.data || {};
  const remarks = str(request.data?.remarks, 1000);
  const by = actorRef(actor);
  if (!['approve', 'reject'].includes(decision)) fail('invalid-argument', 'Invalid decision.');

  // Only the FC-CC (or Main Admin) decides; approvals are digitally signed.
  const settings = await loadSettings();
  const current = (await db.ref(`bookings/${bookingId}`).get()).val();
  if (!current) fail('not-found', 'Booking not found.');

  const { after } = await mutateBooking(bookingId, (b) => {
    if (decision === 'reject') {
      if (!ACTIVE_STATUSES.includes(b.status)) fail('failed-precondition', 'Only active bookings can be rejected.');
      if (!remarks) fail('invalid-argument', 'Please enter a reason for rejection.');
      b.status = STATUS.REJECTED;
      b.rejection = { byUid: actor.uid, byName: actor.name, role: by.role, at: Date.now(), reason: remarks };
      return addHistory(b, { event: 'REJECTED', actor: by, note: remarks });
    }
    // Approval is only for bookings whose other approvals are complete.
    if (b.status === STATUS.PENDING_FC_APPROVAL) fail('failed-precondition', 'The FC student must approve this booking first.');
    if (b.status === STATUS.PENDING_DEPT_CC) fail('failed-precondition', 'The Dept CC must approve this booking first.');
    if (b.status === STATUS.PENDING_DIRECTOR) fail('failed-precondition', 'This booking is now with the Director.');
    if (b.status === STATUS.PENDING_SPECIAL_APPROVAL) fail('failed-precondition', 'Use the special approval tracker to approve this booking.');
    if (b.status === STATUS.FACULTY_CONCERN) fail('failed-precondition', 'Resolve the faculty concern instead.');
    if (![STATUS.SUBMITTED, STATUS.FC_APPROVED, STATUS.PENDING_FCCC_APPROVAL].includes(b.status)) fail('failed-precondition', 'This booking cannot be approved.');
    const at = Date.now();
    b.fcccApproval = {
      byUid: actor.uid, byName: actor.name, role: actor.role, at, remarks: remarks || null,
      signature: digitalSignature({ name: actor.name, role: 'FC-CC', at, ref: bookingId }),
    };
    b.status = statusAfter(b, 'fccc'); // special → the Director next
    return addHistory(b, {
      event: b.status === STATUS.APPROVED ? 'APPROVED & DIGITALLY SIGNED BY FC-CC' : 'FC-CC APPROVED & SIGNED — SENT TO THE DIRECTOR',
      actor: by,
      note: remarks,
    });
  });

  await syncSlots(after);
  if (after.status === STATUS.REJECTED && after.fcApprovalId) {
    const ref = db.ref(`fcApprovals/${after.fcApprovalId}/state`);
    if ((await ref.get()).val() === FC_APPROVAL_STATE.PENDING) await ref.set(FC_APPROVAL_STATE.CANCELLED);
  }
  await logApproval(by, {
    bookingId: after.id,
    kind: decision === 'approve' ? 'fccc' : 'admin',
    decision,
    remarks,
    auditAction: decision === 'approve' ? 'ADMIN_APPROVED' : 'ADMIN_REJECTED',
  });
  if (decision === 'reject') await sendAll([N.rejectedEmail(after, remarks)]);
  else if (after.status === STATUS.APPROVED) {
    await sendAll([N.approvedEmail(after), N.adminApprovedNoticeEmail(after, settings.bookingRules.approvalNotifyEmails)]);
  } else {
    await sendAll([N.stepApprovedEmail(after, 'FC-CC', 'Director')]);
    await requestDecision(after); // one-click email to the Director
  }
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
  if (!b.signature?.path) return { dataUrl: null, signature: b.signature || null }; // text signature
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

// ---- Equipment check-out / return (FC staff) -----------------------------------
export const recordEquipment = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, ADMIN_ROLES, 'Only FC staff can record equipment.');
  const { bookingId, action } = request.data || {};
  const note = str(request.data?.note, 500);
  const condition = request.data?.condition === 'issue' ? 'issue' : 'ok';
  if (!['issue', 'return'].includes(action)) fail('invalid-argument', 'Invalid action.');
  if (action === 'return' && condition === 'issue' && !note) fail('invalid-argument', 'Please describe the problem (damage / missing item).');
  const by = actorRef(actor);
  const { after } = await mutateBooking(bookingId, (b) => {
    if (![STATUS.APPROVED, STATUS.COMPLETED].includes(b.status)) fail('failed-precondition', 'Only approved bookings can have equipment issued.');
    const log = b.equipmentLog || {};
    if (action === 'issue') {
      if (log.issued) fail('failed-precondition', 'Equipment was already issued for this booking.');
      log.issued = { at: Date.now(), byUid: actor.uid, byName: actor.name, items: b.equipmentList || [], note: note || null };
    } else {
      if (!log.issued) fail('failed-precondition', 'Mark the equipment as issued first.');
      if (log.returned) fail('failed-precondition', 'Equipment was already returned.');
      log.returned = { at: Date.now(), byUid: actor.uid, byName: actor.name, condition, note: note || null };
    }
    b.equipmentLog = log;
    return addHistory(b, {
      event: action === 'issue' ? 'EQUIPMENT ISSUED' : condition === 'issue' ? 'EQUIPMENT RETURNED — PROBLEM REPORTED' : 'EQUIPMENT RETURNED — OK',
      actor: by,
      note: note || null,
    });
  });
  const [ap, av] = auditEntry(by, action === 'issue' ? 'EQUIPMENT_ISSUED' : 'EQUIPMENT_RETURNED', {
    bookingId: after.id, niftId: after.niftId, details: { condition: action === 'return' ? condition : null, note },
  });
  await db.ref(ap).set(av);
  return { ok: true, equipmentLog: after.equipmentLog };
});

// ---- Re-send the one-click email to the Dept CC / Director (FC staff) ----------
export const resendDecisionEmail = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, ADMIN_ROLES, 'Only FC staff can re-send approval emails.');
  const b = (await db.ref(`bookings/${String(request.data?.bookingId || '')}`).get()).val();
  if (!b) fail('not-found', 'Booking not found.');
  if (![STATUS.PENDING_DEPT_CC, STATUS.PENDING_DIRECTOR].includes(b.status)) fail('failed-precondition', 'This booking is not waiting for the Dept CC or the Director.');
  const r = await requestDecision(b);
  if (r?.skipped) fail('failed-precondition', 'Email is not set up (Google Sheet).');
  if (!r?.ok) fail('internal', `The Google Sheet could not send it: ${r?.error || 'unknown error'}`);
  return { ok: true, sentTo: r.sentTo || null };
});
