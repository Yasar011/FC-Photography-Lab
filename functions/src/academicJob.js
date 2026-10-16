// Semester progression / graduation and automatic booking completion.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db, loadSettings, auditEntry, SYSTEM_ACTOR, TS } from './core.js';
import { addHistory, mutateBooking, syncSlots } from './bookingCore.js';
import { STATUS, ACCOUNT_STATUS, TIMEZONE, PENDING_STATUSES, FC_APPROVAL_STATE, niftKey } from '../shared/constants.js';
import { SMTP_PASS, sendAll } from './mail.js';
import * as N from './notify.js';
import { dueProgressionEvents, progressStudent, PROGRESSION_LABELS, runKey } from '../shared/academic.js';
import { todayIST } from '../shared/calendar.js';

/**
 * Apply a progression event to every ACTIVE student. Records are updated, never
 * deleted — graduated students keep their bookings, approvals and history.
 */
export async function applyProgression(event, actor = SYSTEM_ACTOR, { dryRun = false, key = null } = {}) {
  const users = (await db.ref('users').get()).val() || {};
  const changes = [];
  for (const [uid, u] of Object.entries(users)) {
    if (!u?.niftId) continue;
    const patch = progressStudent(u, event);
    if (patch) changes.push({ uid, niftId: u.niftId, name: u.name, from: { semester: u.semester, status: u.status }, patch });
  }
  if (dryRun) {
    return { dryRun: true, event, count: changes.length, sample: changes.slice(0, 50) };
  }

  const action = event === 'graduation' ? 'GRADUATION' : 'SEMESTER_UPDATE';
  const CHUNK = 400;
  for (let i = 0; i < changes.length; i += CHUNK) {
    const updates = {};
    for (const c of changes.slice(i, i + CHUNK)) {
      const k = niftKey(c.niftId);
      for (const [field, value] of Object.entries(c.patch)) {
        updates[`users/${c.uid}/${field}`] = value;
        if (field !== 'bookingAccess') updates[`students/${k}/${field}`] = value;
      }
      updates[`users/${c.uid}/updatedAt`] = TS;
      if (c.patch.status === ACCOUNT_STATUS.GRADUATED) updates[`users/${c.uid}/graduatedAt`] = TS;
      const [ap, av] = auditEntry(actor, action, { niftId: c.niftId, details: { event, from: c.from, to: c.patch } });
      updates[ap] = av;
    }
    await db.ref().update(updates);
  }
  const [ap, av] = auditEntry(actor, 'SEMESTER_PROGRESSION_RUN', {
    details: { event, label: PROGRESSION_LABELS[event], students: changes.length, key },
  });
  const updates = { [ap]: av };
  if (key) updates[`settings/academicCalendar/lastRuns/${key}`] = { at: TS, students: changes.length, by: actor.name };
  await db.ref().update(updates);
  return { dryRun: false, event, count: changes.length };
}

// Daily at 00:20 IST.
export const academicScheduler = onSchedule(
  { schedule: '20 0 * * *', timeZone: TIMEZONE },
  async () => {
    const settings = await loadSettings();
    const cal = settings.academicCalendar;
    const due = dueProgressionEvents(todayIST(), cal, cal.lastRuns || {});
    for (const ev of due) {
      // Claim the run first so overlapping executions cannot double-apply.
      const claim = await db.ref(`settings/academicCalendar/lastRuns/${ev.key}`).transaction((cur) =>
        cur ? undefined : { at: Date.now(), status: 'running' },
      );
      if (!claim.committed) continue;
      logger.info('Running semester progression', ev);
      await applyProgression(ev.event, SYSTEM_ACTOR, { key: runKey(ev.year, ev.event) });
    }
  },
);

// Every 15 minutes: APPROVED → COMPLETED once the end time has passed.
export const EXPIRY_REASON = 'Expired — the required approvals were not completed before the booking time.';

/**
 * Pending bookings whose time has passed can never be used: close them as
 * REJECTED (with an "expired" reason), cancel open FC requests and tell the student.
 */
export async function expireStaleBookings(now = Date.now()) {
  const stale = [];
  for (const status of PENDING_STATUSES) {
    const snap = await db.ref('bookings').orderByChild('status').equalTo(status).get();
    snap.forEach((c) => {
      const b = c.val();
      if (b?.endAt && b.endAt <= now) stale.push(b.id);
    });
  }
  for (const id of stale) {
    try {
      const { after } = await mutateBooking(id, (b) => {
        if (!PENDING_STATUSES.includes(b.status) || b.endAt > now) throw new Error('skip');
        b.status = STATUS.REJECTED;
        b.rejection = { byUid: 'system', byName: 'System', role: 'system', at: Date.now(), reason: EXPIRY_REASON, expired: true };
        return addHistory(b, { event: 'EXPIRED — NOT APPROVED IN TIME', actor: SYSTEM_ACTOR, note: EXPIRY_REASON });
      });
      await syncSlots(after);
      if (after.fcApprovalId) {
        const ref = db.ref(`fcApprovals/${after.fcApprovalId}/state`);
        if ((await ref.get()).val() === FC_APPROVAL_STATE.PENDING) await ref.set(FC_APPROVAL_STATE.CANCELLED);
      }
      const [ap, av] = auditEntry(SYSTEM_ACTOR, 'BOOKING_EXPIRED', { bookingId: id, niftId: after.niftId });
      await db.ref(ap).set(av);
      await sendAll([N.rejectedEmail(after, EXPIRY_REASON)]);
    } catch (err) {
      if (err.message !== 'skip') logger.error('Expiry failed', { id, err: err.message });
    }
  }
  return stale.length;
}

export const completeBookings = onSchedule(
  { schedule: 'every 15 minutes', timeZone: TIMEZONE, secrets: [SMTP_PASS] },
  async () => {
    const expired = await expireStaleBookings();
    if (expired) logger.info(`Expired ${expired} stale pending bookings`);
    const snap = await db.ref('bookings').orderByChild('status').equalTo(STATUS.APPROVED).get();
    const now = Date.now();
    const due = [];
    snap.forEach((c) => {
      const b = c.val();
      if (b?.endAt && b.endAt <= now) due.push(b.id);
    });
    for (const id of due) {
      try {
        const { after } = await mutateBooking(id, (b) => {
          if (b.status !== STATUS.APPROVED || b.endAt > Date.now()) throw new Error('skip');
          b.status = STATUS.COMPLETED;
          b.completedAt = Date.now();
          return addHistory(b, { event: 'COMPLETED', actor: SYSTEM_ACTOR });
        });
        await syncSlots(after);
        const [ap, av] = auditEntry(SYSTEM_ACTOR, 'BOOKING_COMPLETED', { bookingId: id, niftId: after.niftId });
        await db.ref(ap).set(av);
      } catch (err) {
        if (err.message !== 'skip') logger.error('Completion failed', { id, err: err.message });
      }
    }
    if (due.length) logger.info(`Completed ${due.length} bookings`);
  },
);
