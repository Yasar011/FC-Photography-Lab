// Booking state machine primitives shared by all booking callables.
import { db, fail, auditEntry } from './core.js';
import {
  SLOT_HOLDING_STATUSES,
  STATUS,
  STATUS_META,
  ACCOUNT_STATUS,
  niftKey,
  normalizeNiftId,
} from '../shared/constants.js';
import { slotKey } from '../shared/calendar.js';

export const SLOT_TAKEN_MSG =
  'This slot has just been booked by another student. Please select another available time.';

export const hoursOf = (b) => {
  const out = [];
  for (let h = Number(b.startHour); h < Number(b.endHour); h++) out.push(h);
  return out;
};

const newKey = () => db.ref('bookings').push().key;

/** Append a status-history entry (mutates the booking object). */
export function addHistory(b, { status = b.status, event, actor, note = null, at = Date.now() }) {
  b.history = b.history || {};
  b.history[newKey()] = {
    at,
    status,
    event: event || STATUS_META[status]?.label?.toUpperCase() || status,
    by: actor?.name || 'System',
    uid: actor?.uid || 'system',
    role: actor?.role || 'student',
    note: note || null,
  };
  return b;
}

/**
 * Atomically read-modify-write a booking. `mutate` receives a copy of the
 * current booking and returns the new value, or throws an HttpsError to abort.
 */
export async function mutateBooking(id, mutate) {
  if (!/^FC-\d{6}-\d{4,}$/.test(String(id || ''))) fail('invalid-argument', 'Invalid booking ID.');
  let error = null;
  let before = null;
  const res = await db.ref(`bookings/${id}`).transaction((cur) => {
    if (cur === null) return null; // first pass may be an empty local cache
    error = null;
    try {
      before = cur;
      const next = mutate(JSON.parse(JSON.stringify(cur)));
      next.updatedAt = Date.now();
      return next;
    } catch (e) {
      error = e;
      return undefined; // abort
    }
  });
  if (error) throw error;
  if (!res.committed || !res.snapshot.exists()) fail('not-found', 'Booking not found.');
  return { before, after: res.snapshot.val() };
}

/** Keep /bookingSlots in step with the booking's status (release on reject/cancel). */
export async function syncSlots(b) {
  const hold = SLOT_HOLDING_STATUSES.includes(b.status);
  await db.ref(`bookingSlots/${b.date}`).transaction((cur) => {
    if (cur === null) return null;
    for (const h of hoursOf(b)) {
      const k = slotKey(h);
      if (cur[k]?.bookingId !== b.id) continue;
      if (hold) cur[k].status = b.status;
      else delete cur[k];
    }
    return cur;
  });
}

/** Write an /approvals log record + audit entry in one update. */
export async function logApproval(actor, { bookingId, kind, step = null, decision, remarks = null, auditAction }) {
  const ref = db.ref('approvals').push();
  const [auditPath, auditVal] = auditEntry(actor, auditAction, { bookingId, details: { kind, step, decision, remarks } });
  await db.ref().update({
    [`approvals/${ref.key}`]: {
      bookingId,
      kind,
      step,
      decision,
      remarks,
      byUid: actor.uid,
      byName: actor.name,
      role: actor.role || 'student',
      at: Date.now(),
    },
    [auditPath]: auditVal,
  });
}

/** Find a registered student by NIFT ID → { uid, user } or null. */
export async function findStudent(niftId) {
  const id = normalizeNiftId(niftId);
  if (!id) return null;
  const reg = (await db.ref(`students/${niftKey(id)}`).get()).val();
  if (!reg?.uid) return null;
  const user = (await db.ref(`users/${reg.uid}`).get()).val();
  if (!user) return null;
  return { uid: reg.uid, user };
}

export function accountBlockReason(user) {
  if (!user) return 'Student profile not found.';
  if (user.status === ACCOUNT_STATUS.GRADUATED) return 'Graduated students cannot create new bookings.';
  if (user.status !== ACCOUNT_STATUS.ACTIVE) return 'This account is not active. Please contact the FC Staff.';
  if (user.bookingAccess === false) return 'Booking access is disabled for this account.';
  return null;
}

export const isTerminal = (s) =>
  [STATUS.REJECTED, STATUS.CANCELLED_BY_ADMIN, STATUS.CANCELLED_BY_STUDENT, STATUS.COMPLETED].includes(s);
