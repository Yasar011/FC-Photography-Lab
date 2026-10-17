// Keeps the free Realtime Database (Spark plan: 1 GB) from filling up.
// Once a day an admin's browser estimates the size; only when it passes 70 %
// is old data deleted, oldest and least important first, until it is under 50 %.
import {
  ref as dbRef, get, update, runTransaction, query, orderByChild, endAt, limitToFirst, serverTimestamp,
} from 'firebase/database';
import { db, auth } from '../firebase.js';
import { todayIST, addDays } from '@shared/calendar.js';

const LIMIT = 1024 ** 3; // Spark plan storage
const CLEAN_AT = 0.7 * LIMIT;
const TARGET = 0.5 * LIMIT;
const DAY = 86400000;

// Rough size of one record of each kind (bytes).
const WEIGHTS = {
  bookings: 4000, bookingSlots: 1200, fcApprovals: 450, facultyNotifications: 400, approvals: 400,
  auditLogs: 500, emailLogs: 450, users: 700, students: 350, files: 20000, admins: 300, roles: 150,
};

/** Count children with a cheap "shallow" REST read (keys only). */
async function countKeys(path) {
  const token = await auth.currentUser?.getIdToken();
  const base = String(import.meta.env.VITE_FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/${path}.json?shallow=true&auth=${encodeURIComponent(token)}`);
  if (!res.ok) return 0;
  const j = await res.json();
  return j && typeof j === 'object' ? Object.keys(j).length : 0;
}

export async function estimateUsage() {
  const counts = {};
  await Promise.all(Object.keys(WEIGHTS).map(async (k) => { counts[k] = await countKeys(k); }));
  const bytes = Object.entries(counts).reduce((sum, [k, n]) => sum + n * WEIGHTS[k], 0);
  return { bytes, counts, limit: LIMIT, percent: Math.round((bytes / LIMIT) * 1000) / 10 };
}

/** Delete records of `path` whose `field` is older than `cutoff`, in batches. */
async function deleteOlder(path, field, cutoff, extra = () => ({})) {
  let removed = 0;
  for (;;) {
    const snap = await get(query(dbRef(db, path), orderByChild(field), endAt(cutoff), limitToFirst(300)));
    if (!snap.exists()) break;
    const updates = {};
    snap.forEach((c) => {
      updates[`${path}/${c.key}`] = null;
      Object.assign(updates, extra(c.key, c.val()));
    });
    await update(dbRef(db), updates);
    removed += snap.size;
    if (snap.size < 300) break;
  }
  return removed;
}

/** Runs at most once a day (across all admins). */
export async function runMaintenance({ force = false } = {}) {
  const claim = await runTransaction(dbRef(db, 'maintenance/lastRun'), (cur) =>
    !force && cur && Date.now() - cur < DAY ? undefined : Date.now());
  if (!claim.committed) return { skipped: true };

  let usage = await estimateUsage();
  const log = [];
  const ms = (days) => Date.now() - days * DAY;
  const date = (days) => addDays(todayIST(), -days);
  const steps = [
    ['email log older than 6 months', () => deleteOlder('emailLogs', 'createdAt', ms(183))],
    ['audit log older than 1 year', () => deleteOlder('auditLogs', 'at', ms(365))],
    ['approval log older than 1 year', () => deleteOlder('approvals', 'at', ms(365))],
    ['stored files of bookings older than 6 months', null], // strips files, keeps the bookings
    ['bookings older than 18 months', () => deleteOlder('bookings', 'date', date(548), (id, b) => ({
      [`files/${id}`]: null,
      [`facultyNotifications/${id}`]: null,
      ...(b?.fcApprovalId ? { [`fcApprovals/${b.fcApprovalId}`]: null } : {}),
      ...(b?.date ? { [`bookingSlots/${b.date}`]: null } : {}),
    }))],
  ];
  if (usage.bytes > CLEAN_AT) {
    for (const [label, run] of steps) {
      if (usage.bytes <= TARGET) break;
      if (!run) {
        const snap = await get(query(dbRef(db, 'bookings'), orderByChild('date'), endAt(date(183))));
        const updates = {};
        snap.forEach((c) => { updates[`files/${c.key}`] = null; });
        if (Object.keys(updates).length) await update(dbRef(db), updates);
        log.push(`${label}: ${Object.keys(updates).length}`);
      } else {
        log.push(`${label}: ${await run()}`);
      }
      usage = await estimateUsage();
    }
  }
  await update(dbRef(db, 'maintenance'), {
    lastEstimate: { bytes: usage.bytes, percent: usage.percent, counts: usage.counts, at: serverTimestamp() },
    ...(log.length ? { lastCleanup: { at: serverTimestamp(), log } } : {}),
  });
  return { usage, log };
}
