// In-browser backend (Spark plan, no Cloud Functions): the same code as
// functions/src runs here as the signed-in user. The Realtime Database security
// rules are what really protect the data — see database.rules.json.
import '../demo/buffer-global.js'; // first: the backend code expects Node's global Buffer
import * as fns from '../../../functions/src/index.js';
import { auth } from '../firebase.js';
import { runMaintenance } from './maintenance.js';

// The Google Sheet (Apps Script) verifies this Firebase ID token before sending email.
globalThis.__fcIdToken = () => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null));

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** Run one backend action (what used to be a Cloud Function call). */
export async function localCall(name, data) {
  const fn = fns[name];
  if (!fn?.__handler) throw Object.assign(new Error('This action is not available.'), { code: 'not-found' });
  const u = auth.currentUser;
  const request = {
    auth: u
      ? { uid: u.uid, token: { email: String(u.email || '').toLowerCase(), email_verified: u.emailVerified === true, name: u.displayName || '' } }
      : null,
    data: clone(data ?? {}),
  };
  return clone(await fn.__handler(request));
}

// ---- Automatic jobs (Cloud Scheduler replacement) ---------------------------
// Run while any admin has the app open: complete finished bookings, expire
// bookings nobody approved in time, semester progression, and — once a day —
// delete old data when the free database is getting full.
let timer = null;
let running = false;

async function tick(role) {
  if (running || !auth.currentUser) return;
  running = true;
  try {
    await fns.completeBookings.__schedule().catch((e) => console.warn('[jobs] bookings', e.message));
    if (role === 'main' || role === 'staff') {
      await fns.academicScheduler.__schedule().catch((e) => console.warn('[jobs] academic', e.message));
      await runMaintenance().catch((e) => console.warn('[jobs] maintenance', e.message));
    }
  } finally {
    running = false;
  }
}

export function startAdminJobs(role) {
  stopAdminJobs();
  const first = setTimeout(() => tick(role), 15000 + Math.random() * 15000); // after the app has settled
  timer = { first, every: setInterval(() => tick(role), 10 * 60 * 1000) };
}

export function stopAdminJobs() {
  if (!timer) return;
  clearTimeout(timer.first);
  clearInterval(timer.every);
  timer = null;
}

export { runMaintenance, estimateUsage } from './maintenance.js';
