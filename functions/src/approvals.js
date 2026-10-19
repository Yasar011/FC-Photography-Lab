// FC student approvals, the special (out-of-hours) approval chain, and faculty concerns.
import crypto from 'node:crypto';
import { onCall } from 'firebase-functions/v2/https';

import { db, fail, getActor, requireRole, actorRef, auditEntry, str, ADMIN_ROLES, loadSettings } from './core.js';
import { sendAll, adminEmails, requestDecision } from './mail.js';
import * as N from './notify.js';
import { CALL_OPTS } from './bookings.js';
import { addHistory, mutateBooking, syncSlots, logApproval } from './bookingCore.js';
import {
  STATUS,
  ACTIVE_STATUSES,
  FC_APPROVAL_STATE,
  SPECIAL_STEPS,
  specialStepsFor,
  ACCOUNT_STATUS,
  STATUS_META,
  digitalSignature,
  statusAfter,
} from '../shared/constants.js';
import { formatRange, formatDate } from '../shared/calendar.js';

/** Status a booking moves to once the FC approval is in hand. */
const afterFcStatus = (b) => statusAfter(b, 'fcStudent'); // → Dept CC (other departments)

// ---- FC student approves / rejects --------------------------------------------
export const respondFcApproval = onCall(CALL_OPTS, async (request) => {
  const actor = await getActor(request);
  const { approvalId, decision } = request.data || {};
  const reason = str(request.data?.reason, 500);
  if (!['approve', 'reject'].includes(decision)) fail('invalid-argument', 'Invalid decision.');
  if (!/^[-\w]{10,40}$/.test(String(approvalId || ''))) fail('invalid-argument', 'Invalid approval request.');

  const approvalRef = db.ref(`fcApprovals/${approvalId}`);
  const approval = (await approvalRef.get()).val();
  if (!approval) fail('not-found', 'Approval request not found.');
  // The named FC student answers — or FC staff (any admin) answers on their behalf.
  const onBehalf = approval.fcStudentUid !== actor.uid && ADMIN_ROLES.includes(actor.role);
  if (approval.fcStudentUid !== actor.uid && !onBehalf) fail('permission-denied', 'This approval request is assigned to another student.');
  if (!onBehalf && actor.profile?.status !== ACCOUNT_STATUS.ACTIVE) fail('failed-precondition', 'Your account is not active.');
  if (onBehalf && decision === 'reject' && !reason) fail('invalid-argument', 'Please enter a reason for rejection.');
  const byName = onBehalf ? `${actor.name} (FC staff, for FC student ${approval.fcStudentName})` : actor.name;

  // Claim the decision atomically so a double click cannot approve twice.
  const newState = decision === 'approve' ? FC_APPROVAL_STATE.APPROVED : FC_APPROVAL_STATE.REJECTED;
  const claim = await approvalRef.child('state').transaction((cur) => {
    if (cur === null) return null;
    return cur === FC_APPROVAL_STATE.PENDING ? newState : undefined;
  });
  if (!claim.committed || claim.snapshot.val() !== newState) {
    fail('failed-precondition', 'This request has already been answered or cancelled.');
  }

  const by = actorRef(actor);
  let after;
  try {
    ({ after } = await mutateBooking(approval.bookingId, (b) => {
      const inConcern = b.status === STATUS.FACULTY_CONCERN && b.facultyConcern?.previousStatus === STATUS.PENDING_FC_APPROVAL;
      if (b.status !== STATUS.PENDING_FC_APPROVAL && !inConcern) {
        fail('failed-precondition', 'This booking is no longer waiting for FC approval.');
      }
      b.fcApproval = { state: newState, byUid: actor.uid, byName, at: Date.now(), reason: reason || null, ...(onBehalf ? { onBehalf: true } : {}) };
      if (decision === 'approve') {
        addHistory(b, {
          status: STATUS.FC_APPROVED,
          event: onBehalf ? 'FC STUDENT STEP APPROVED BY FC STAFF' : 'FC STUDENT APPROVED',
          actor: by,
          note: onBehalf ? `On behalf of ${approval.fcStudentName}${reason ? ` — ${reason}` : ''}` : null,
        });
        const next = afterFcStatus(b);
        if (inConcern) {
          b.facultyConcern.previousStatus = next; // stays under review
        } else {
          b.status = next;
          addHistory(b, {
            event: next === STATUS.PENDING_DEPT_CC ? 'SENT TO THE DEPT CC FOR APPROVAL' : 'SENT TO FC-CC FOR APPROVAL',
            actor: next === STATUS.APPROVED ? { name: 'System', uid: 'system', role: 'system' } : by,
            at: Date.now() + 1,
          });
        }
      } else {
        b.status = STATUS.REJECTED;
        b.rejection = { byUid: actor.uid, byName, role: onBehalf ? actor.role : 'fc_student', at: Date.now(), reason: reason || 'Rejected by FC student' };
        addHistory(b, { event: onBehalf ? 'FC STUDENT STEP REJECTED BY FC STAFF' : 'FC STUDENT REJECTED', actor: by, note: reason });
      }
      return b;
    }));
  } catch (err) {
    await approvalRef.child('state').set(FC_APPROVAL_STATE.PENDING); // undo the claim
    throw err;
  }

  await Promise.all([
    approvalRef.update({ respondedAt: Date.now(), reason: reason || null }),
    syncSlots(after),
    logApproval(by, {
      bookingId: after.id,
      kind: 'fc_student',
      decision,
      remarks: reason,
      auditAction: decision === 'approve' ? 'FC_APPROVED' : 'FC_REJECTED',
    }),
  ]);

  const emails = [];
  if (decision === 'reject') emails.push(N.fcRejectedEmail(after, reason));
  else {
    emails.push(N.fcApprovedEmail(after));
    if (after.status === STATUS.PENDING_FCCC_APPROVAL) emails.push(N.fcccApprovalNeededEmail(after, await adminEmails(['fccc', 'main'])));
  }
  await sendAll(emails);
  if (decision === 'approve' && [STATUS.PENDING_DEPT_CC, STATUS.PENDING_DIRECTOR].includes(after.status)) {
    await requestDecision(after); // one-click email to the Dept CC
  }
  return { status: after.status };
});

// ---- Special approval chain ---------------------------------------------------
// System steps: fcAssistant (form printed & issued) → final (FC-CC approves &
// signs digitally). The paper signatures in between (Dept CC / faculty for other
// departments, Director's PA, Director) are verified by the FC-CC at final approval.
export const specialApprovalStep = onCall(CALL_OPTS, async (request) => {
  const actor = await getActor(request);
  requireRole(actor, ADMIN_ROLES);
  const { bookingId, decision } = request.data || {};
  // 'director' (+withFinal) is accepted from older clients and means final approval.
  const step = request.data?.step === 'director' ? 'final' : request.data?.step;
  const remarks = str(request.data?.remarks, 1000);
  const stepDef = SPECIAL_STEPS.find((s) => s.key === step && s.system);
  if (!stepDef) fail('invalid-argument', 'Unknown approval step.');
  if (!stepDef.roles.includes(actor.role)) fail('permission-denied', `Your role cannot record the ${stepDef.label} step.`);
  if (!['approve', 'reject'].includes(decision)) fail('invalid-argument', 'Invalid decision.');
  if (decision === 'reject' && !remarks) fail('invalid-argument', 'Please enter a reason for rejection.');
  // The FC Lab Assistant only prints & issues the form; rejecting is an FC-CC decision.
  if (decision === 'reject' && !['fccc', 'main'].includes(actor.role)) fail('permission-denied', 'Only the FC-CC can reject a booking.');
  const by = actorRef(actor);

  const nextSystemStep = (b) => (b.special?.steps?.fcAssistant?.state === 'approved' ? 'final' : 'fcAssistant');
  const current = (await db.ref(`bookings/${bookingId}`).get()).val();
  if (!current) fail('not-found', 'Booking not found.');
  if (current.status !== STATUS.PENDING_SPECIAL_APPROVAL) fail('failed-precondition', 'This booking is not awaiting special approval.');
  if (nextSystemStep(current) !== step) {
    fail('failed-precondition', step === 'final' ? 'The FC Lab Assistant must issue the form first.' : 'The form has already been issued.');
  }

  // The FC-CC's final approval carries her digital signature (a text stamp).
  // The FC Lab Assistant only prints and hands over the form.
  const now0 = Date.now();
  const signature = decision === 'approve' && step === 'final'
    ? digitalSignature({ name: actor.name, role: 'FC-CC', at: now0, ref: bookingId })
    : null;

  const { after } = await mutateBooking(bookingId, (b) => {
    if (b.status !== STATUS.PENDING_SPECIAL_APPROVAL) fail('failed-precondition', 'This booking is not awaiting special approval.');
    if (nextSystemStep(b) !== step) fail('failed-precondition', 'This step has already been recorded.');
    b.special = b.special || { required: true };
    const steps = (b.special.steps = b.special.steps || {});
    const now = Date.now();
    const rec = (state, extra = {}) => ({ state, byUid: actor.uid, byName: actor.name, role: actor.role, at: now, remarks: remarks || null, ...extra });
    if (decision === 'reject') {
      steps[step] = rec('rejected');
      b.status = STATUS.REJECTED;
      b.rejection = { byUid: actor.uid, byName: actor.name, role: actor.role, at: now, reason: `${stepDef.label}: ${remarks}` };
      return addHistory(b, { event: `REJECTED AT ${stepDef.label.toUpperCase()}`, actor: by, note: remarks });
    }
    if (step === 'fcAssistant') {
      steps.fcAssistant = rec('approved');
      return addHistory(b, { event: stepDef.done.toUpperCase(), actor: by, note: remarks, at: now });
    }
    // Final: record the paper signatures as verified by the FC-CC, then approve.
    for (const p of specialStepsFor(b.studentType).filter((x) => x.paper)) {
      steps[p.key] = { state: 'approved', paper: true, verifiedBy: actor.name, byName: actor.name, at: now };
      addHistory(b, { event: `${p.done.toUpperCase()} (VERIFIED ON PAPER FORM)`, actor: by, at: now });
    }
    steps.final = rec('approved', { signature });
    addHistory(b, { event: stepDef.done.toUpperCase(), actor: by, note: remarks, at: now + 1 });
    b.status = STATUS.APPROVED;
    return addHistory(b, { event: 'APPROVED', actor: by, at: now + 2, note: 'Give the signed form to the Admin Guard.' });
  });

  await Promise.all([
    syncSlots(after),
    logApproval(by, {
      bookingId: after.id,
      kind: 'special',
      step,
      decision,
      remarks,
      auditAction: decision === 'approve' ? 'SPECIAL_STEP_APPROVED' : 'SPECIAL_STEP_REJECTED',
    }),
  ]);
  if (after.status === STATUS.APPROVED) {
    const notify = (await loadSettings()).bookingRules.approvalNotifyEmails;
    await sendAll([N.approvedEmail(after, 'special.final'), N.adminApprovedNoticeEmail(after, notify)]);
  }
  else if (after.status === STATUS.REJECTED) await sendAll([N.rejectedEmail(after, `${stepDef.label}: ${remarks}`)]);
  else if (step === 'fcAssistant') await sendAll([N.formIssuedEmail(after)]);
  return { status: after.status };
});

// ---- Faculty concern resolution (Staff Admin / FC-CC) ---------------------------
export const resolveFacultyConcern = onCall(CALL_OPTS, async (request) => {
  const actor = await getActor(request);
  requireRole(actor, ['fccc', 'main'], 'Only the FC-CC can decide on a faculty concern.');
  const { bookingId, decision } = request.data || {};
  const remarks = str(request.data?.remarks, 1000);
  if (!['approve', 'reject'].includes(decision)) fail('invalid-argument', 'Invalid decision.');
  if (!remarks) fail('invalid-argument', 'Please enter remarks for this decision.');
  const by = actorRef(actor);

  const { after } = await mutateBooking(bookingId, (b) => {
    if (b.status !== STATUS.FACULTY_CONCERN) fail('failed-precondition', 'This booking has no open faculty concern.');
    b.facultyConcern.resolved = true;
    b.facultyConcern.resolution = { decision, byUid: actor.uid, byName: actor.name, role: actor.role, at: Date.now(), remarks };
    if (decision === 'reject') {
      b.status = STATUS.REJECTED;
      b.rejection = { byUid: actor.uid, byName: actor.name, role: actor.role, at: Date.now(), reason: `Faculty concern: ${remarks}` };
      return addHistory(b, { event: 'REJECTED — FACULTY CONCERN UPHELD', actor: by, note: remarks });
    }
    // Approve: return to the workflow; pending approvals are still required.
    const prev = b.facultyConcern.previousStatus;
    b.status = [STATUS.PENDING_FC_APPROVAL, STATUS.PENDING_SPECIAL_APPROVAL, STATUS.PENDING_FCCC_APPROVAL, STATUS.PENDING_DEPT_CC, STATUS.PENDING_DIRECTOR].includes(prev) ? prev : STATUS.APPROVED;
    return addHistory(b, {
      event: b.status === STATUS.APPROVED ? 'APPROVED — FACULTY CONCERN REVIEWED' : 'FACULTY CONCERN REVIEWED',
      actor: by,
      note: remarks,
    });
  });

  await Promise.all([
    syncSlots(after),
    logApproval(by, {
      bookingId: after.id,
      kind: 'faculty_concern',
      decision,
      remarks,
      auditAction: decision === 'approve' ? 'ADMIN_APPROVED' : 'ADMIN_REJECTED',
    }),
  ]);
  const label = decision === 'approve' ? STATUS_META[after.status].label : 'Rejected';
  await sendAll([
    decision === 'reject' ? N.rejectedEmail(after, remarks) : N.concernResolvedEmail(after, label, remarks),
  ]);
  if ([STATUS.PENDING_DEPT_CC, STATUS.PENDING_DIRECTOR].includes(after.status)) await requestDecision(after);
  if (after.status === STATUS.REJECTED && after.facultyConcern?.previousStatus === STATUS.APPROVED) {
    const notify = (await loadSettings()).bookingRules.approvalNotifyEmails;
    await sendAll([N.adminCancelledNoticeEmail(after, notify, `the FC-CC (${actor.name}) after a faculty concern`, remarks)]);
  }
  return { status: after.status };
});

// ---- Faculty response ("I DID NOT APPROVE THIS") ------------------------------
async function verifyFacultyLink(actor, bookingId, token) {
  if (!/^FC-\d{6}-\d{4,}$/.test(String(bookingId || ''))) fail('invalid-argument', 'Invalid link.');
  const note = (await db.ref(`facultyNotifications/${bookingId}`).get()).val();
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  if (!note || !note.tokenHash || note.tokenHash.length !== hash.length ||
      !crypto.timingSafeEqual(Buffer.from(note.tokenHash), Buffer.from(hash))) {
    fail('permission-denied', 'This link is invalid or has expired.');
  }
  if (note.facultyEmail.toLowerCase() !== actor.email) {
    fail('permission-denied', `This notice was sent to ${note.facultyEmail}. Please sign in with that NIFT Google account.`);
  }
  return note;
}

export const getFacultyNotice = onCall(async (request) => {
  const actor = await getActor(request);
  const { bookingId, token } = request.data || {};
  const note = await verifyFacultyLink(actor, bookingId, token);
  const b = (await db.ref(`bookings/${bookingId}`).get()).val();
  if (!b) fail('not-found', 'Booking not found.');
  return {
    response: note.response || null,
    booking: {
      id: b.id,
      status: b.status,
      studentName: b.studentName,
      niftId: b.niftId,
      department: b.department,
      semester: b.semester,
      date: formatDate(b.date, { weekday: true }),
      time: formatRange(b.startHour, b.endHour),
      purpose: b.purpose,
      equipment: (b.equipmentList || []).join(', '),
      facultyName: b.faculty?.name,
    },
  };
});

export const facultyRespond = onCall(CALL_OPTS, async (request) => {
  const actor = await getActor(request);
  const { bookingId, token } = request.data || {};
  const remarks = str(request.data?.remarks, 1000);
  const note = await verifyFacultyLink(actor, bookingId, token);
  if (note.response) fail('already-exists', 'Your response has already been recorded.');
  const by = { ...actorRef(actor), role: 'faculty' };
  const respondedAt = Date.now();

  // 1. Store the response (no booking is cancelled automatically).
  await db.ref(`facultyNotifications/${bookingId}/response`).set({
    type: 'DID_NOT_APPROVE',
    remarks: remarks || null,
    byUid: actor.uid,
    byEmail: actor.email,
    at: respondedAt,
  });

  // 2. Status → FACULTY CONCERN (only while the booking is still active).
  let after;
  const { after: b } = await mutateBooking(bookingId, (bk) => {
    bk.facultyConcern = {
      at: respondedAt,
      facultyName: note.facultyName,
      facultyEmail: note.facultyEmail,
      remarks: remarks || null,
      previousStatus: bk.status,
      resolved: false,
    };
    if (ACTIVE_STATUSES.includes(bk.status) && bk.status !== STATUS.FACULTY_CONCERN) {
      bk.status = STATUS.FACULTY_CONCERN;
    }
    return addHistory(bk, { event: 'FACULTY CONCERN — "I DID NOT APPROVE THIS"', actor: by, note: remarks });
  });
  after = b;
  await syncSlots(after);
  const [ap, av] = auditEntry(by, 'FACULTY_CONCERN', { bookingId, niftId: after.niftId, details: { remarks } });
  await db.ref(ap).set(av);

  // 3–4. Notify Staff Admin / FC-CC and the student.
  await sendAll([
    N.facultyConcernAdminEmail(after, await adminEmails(['staff', 'fccc', 'main']), remarks),
    N.facultyConcernStudentEmail(after),
  ]);
  return { ok: true, status: after.status };
});
