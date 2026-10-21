// LIVE test against the real Firebase project (Spark plan setup):
// the in-browser backend + the deployed database rules, signed in as temporary
// test accounts (zz.test.*@nift.ac.in). Everything it creates is deleted at the end.
//   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node scripts/live-test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
const DB_URL = `https://${sa.project_id}-default-rtdb.firebaseio.com`;
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: DB_URL });
const adb = admin.database();
const aauth = admin.auth();
process.env.VITE_SHEETS_WEBHOOK_URL = ''; // never send real email from tests

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const startVite = () => createServer({
  root: webRoot, mode: 'production', configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
  server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] },
});

const U = {
  main: { name: 'ZZ Test Main', role: 'main' },
  staff: { name: 'ZZ Test Staff', role: 'staff' },
  fccc: { name: 'ZZ Test FCCC', role: 'fccc' },
  fc: { name: 'ZZ Test Fc One', niftId: 'FC/99/901', department: 'FC', semester: 6 },
  fc2: { name: 'ZZ Test Fc Two', niftId: 'FC/99/902', department: 'FC', semester: 4 },
  fc3: { name: 'ZZ Test Fc Three', niftId: 'FC/99/903', department: 'FC', semester: 7 },
  fc4: { name: 'ZZ Test Fc Four', niftId: 'FC/99/904', department: 'FC', semester: 5 },
  other: { name: 'ZZ Test Other', niftId: 'FD/99/905', department: 'FD', semester: 6 },
  first: { name: 'ZZ Test First', niftId: 'FC/99/906', department: 'FC', semester: 1 },
  fac: { name: 'ZZ Test Faculty' },
};
for (const [k, u] of Object.entries(U)) Object.assign(u, { uid: `zzt-${k}`, email: `zz.test.${k}@nift.ac.in` });

// ---------------------------------------------------------------- worker mode
// node live-test.mjs --worker <userKey> <json payload> <startAtMs>
if (process.argv[2] === '--worker') {
  const [, , , key, payload, startAt] = process.argv;
  const vite = await startVite();
  let out;
  try {
    const { auth } = await vite.ssrLoadModule('/src/firebase.js');
    const { signInWithCustomToken } = await vite.ssrLoadModule('firebase/auth');
    const { localCall } = await vite.ssrLoadModule('/src/backend/index.js');
    await signInWithCustomToken(auth, await aauth.createCustomToken(U[key].uid));
    await new Promise((r) => setTimeout(r, Math.max(0, Number(startAt) - Date.now())));
    out = { ok: true, r: await localCall('createBooking', JSON.parse(payload)) };
  } catch (e) {
    out = { ok: false, error: e.message };
  }
  console.log(`RESULT ${JSON.stringify(out)}`);
  await vite.close();
  process.exit(0);
}

// ---------------------------------------------------------------- main
let passed = 0;
const failures = [];
const ok = (l) => { passed++; console.log(`  ✓ ${l}`); };
const bad = (l, why) => { failures.push(`${l} — ${why}`); console.log(`  ✗ ${l} — ${why}`); };
const check = (l, c, why = 'assertion failed') => (c ? ok(l) : bad(l, why));

async function cleanup() {
  for (const u of Object.values(U)) await aauth.deleteUser(u.uid).catch(() => {});
  const root = (await adb.ref().once('value')).val() || {};
  const realUsers = Object.keys(root.users || {}).filter((k) => !k.startsWith('zzt-'));
  const realRoles = Object.keys(root.roles || {}).filter((k) => !k.startsWith('zzt-'));
  if (!realUsers.length && !realRoles.length) {
    await adb.ref().set(null); // nothing real yet → back to an empty database
    return 'database emptied (it only held test data)';
  }
  // Real people already use it: remove only test records.
  const updates = {};
  for (const [id, b] of Object.entries(root.bookings || {})) {
    if (String(b.studentUid).startsWith('zzt-')) {
      updates[`bookings/${id}`] = null;
      updates[`facultyNotifications/${id}`] = null;
      updates[`files/${id}`] = null;
      if (b.fcApprovalId) updates[`fcApprovals/${b.fcApprovalId}`] = null;
      for (let h = b.startHour; h < b.endHour; h++) updates[`bookingSlots/${b.date}/h${String(h).padStart(2, '0')}`] = null;
    }
  }
  for (const u of Object.values(U)) {
    updates[`users/${u.uid}`] = null;
    updates[`roles/${u.uid}`] = null;
    updates[`admins/${u.uid}`] = null;
    updates[`slotWatch/${u.uid}`] = null;
    if (u.niftId) updates[`students/${u.niftId.replace(/\//g, '_')}`] = null;
  }
  // Log entries made by the test accounts.
  for (const top of ['auditLogs', 'emailLogs', 'approvals', 'fcApprovals', 'decisionTokens']) {
    for (const [k, v] of Object.entries(root[top] || {})) {
      if (/zzt-|zz\.test\./.test(JSON.stringify(v))) updates[`${top}/${k}`] = null;
    }
  }
  await adb.ref().update(updates);
  return 'test records removed (real data kept)';
}

const vite = await startVite();
try {
  console.log('\nSetup (temporary test accounts)');
  await cleanup();
  for (const u of Object.values(U)) {
    await aauth.createUser({ uid: u.uid, email: u.email, emailVerified: true, displayName: u.name });
  }
  ok('test accounts created');

  const { auth, db } = await vite.ssrLoadModule('/src/firebase.js');
  const { signInWithCustomToken } = await vite.ssrLoadModule('firebase/auth');
  const fdb = await vite.ssrLoadModule('firebase/database');
  const { localCall, runMaintenance } = await vite.ssrLoadModule('/src/backend/index.js');
  const cal = await vite.ssrLoadModule('@shared/calendar.js');

  let current = null;
  const as = async (key) => {
    if (current === key) return;
    await signInWithCustomToken(auth, await aauth.createCustomToken(U[key].uid));
    await auth.currentUser.getIdToken(true);
    await new Promise((r) => setTimeout(r, 400)); // let the database connection re-authenticate
    current = key;
  };
  const call = async (key, name, data) => { await as(key); return localCall(name, data); };
  const expectOk = async (l, p) => { try { const r = await p; ok(l); return r; } catch (e) { bad(l, `unexpected error: ${e.message}`); return null; } };
  const expectFail = async (l, p, re) => {
    try { await p; bad(l, 'was ALLOWED but must be denied'); } catch (e) {
      if (re && !re.test(e.message)) bad(l, `wrong error: ${e.message}`); else ok(`${l} → denied (${e.message.slice(0, 60)})`);
    }
  };
  const raw = async (key, fn) => { await as(key); return fn(fdb, db); };
  const adminGet = async (p) => (await adb.ref(p).once('value')).val();

  // Dates
  const today = cal.todayIST();
  // 2+ days ahead: the 9 AM–4 PM booking hours only apply to today/tomorrow.
  const ahead = [2, 3, 4, 5, 6].map((n) => cal.addDays(today, n));
  // Only days with no real bookings, so the test never touches real students' slots.
  const weekdays = [];
  for (const d of ahead.filter((x) => ![0, 6].includes(cal.dayOfWeek(x)))) {
    if (!(await adminGet(`bookingSlots/${d}`))) weekdays.push(d);
  }
  if (weekdays.length < 2) throw new Error(`Need 2 free weekdays 2–6 days ahead; only found ${weekdays.join(', ') || 'none'}.`);
  const [D1, D2] = weekdays;
  const D3 = D2; // everything below fits in two free days
  console.log(`  (test days: ${weekdays.join(', ')})`);
  const FAC = { facultyName: U.fac.name, facultyEmail: U.fac.email };
  const base = (date, s, e, extra = {}) => ({ date, startHour: s, endHour: e, purpose: 'Live test', equipment: ['photoLab'], answers: { q_team: 1 }, confirmations: { c_agree: true }, signDigitally: true, ...FAC, participants: [{ name: 'Test Person', department: 'FC', hostel: 'Boys Hostel', room: '101' }], ...extra });

  // Admins: main is set directly (the real bootstrap email is not used in tests); main invites the others.
  await adb.ref().update({
    [`roles/${U.main.uid}`]: { role: 'main', email: U.main.email },
    [`admins/${U.main.uid}`]: { role: 'main', email: U.main.email, name: U.main.name },
  });
  await expectOk('Main admin first sign-in (seeds default settings)', call('main', 'syncAccount', {}));
  check('default settings written', Boolean(await adminGet('settings/initializedAt')));
  await expectOk('Main invites FC Lab Assistant (staff)', call('main', 'setAdminRole', { email: U.staff.email, role: 'staff' }));
  await expectOk('Main invites FC-CC', call('main', 'setAdminRole', { email: U.fccc.email, role: 'fccc' }));
  const s1 = await expectOk('Staff signs in → gets invited role', call('staff', 'syncAccount', {}));
  check('staff role = staff', s1?.role === 'staff');
  const s2 = await expectOk('FC-CC signs in → gets invited role', call('fccc', 'syncAccount', {}));
  check('FC-CC role = fccc', s2?.role === 'fccc');

  console.log('\nRegistration');
  for (const k of ['fc', 'fc2', 'fc3', 'fc4', 'other', 'first']) {
    const u = U[k];
    await call(k, 'syncAccount', {});
    await expectOk(`${u.name} registers`, call(k, 'registerStudent', { name: u.name, niftId: u.niftId, department: u.department, semester: u.semester, phone: '+91 90000 00000' }));
  }
  await call('fac', 'syncAccount', {});
  await expectFail('Faculty account registers with an existing NIFT ID', call('fac', 'registerStudent', { name: 'Copy Cat', niftId: U.fc.niftId, department: 'FC', semester: 6, phone: '+91 90000 00000' }), /already registered/);

  console.log('\nNormal booking → FC-CC approval');
  const b1 = await expectOk('FC student books 4 hours', call('fc', 'createBooking', base(D1, 17, 21)));
  const B1 = b1 && await adminGet(`bookings/${b1.bookingId}`);
  check('waits for FC-CC, signed digitally (FPL-NJ)', B1?.status === 'PENDING_FCCC_APPROVAL' && /^FPL-NJ-/.test(B1?.signature?.code || ''));
  await expectFail('FC Lab Assistant approves', call('staff', 'adminBookingDecision', { bookingId: b1.bookingId, decision: 'approve' }), /FC-CC/);
  await expectOk('FC-CC approves & signs', call('fccc', 'adminBookingDecision', { bookingId: b1.bookingId, decision: 'approve' }));
  check('→ APPROVED with FC-CC stamp', (await adminGet(`bookings/${b1.bookingId}/status`)) === 'APPROVED' && Boolean(await adminGet(`bookings/${b1.bookingId}/fcccApproval/signature/code`)));

  console.log('\nOther department → FC student → Dept CC → FC-CC');
  const b2 = await expectOk('FD student books 3 h with FC student', call('other', 'createBooking', base(D2, 17, 19, { fcStudentNiftId: U.fc2.niftId })));
  const fa = await adminGet(`bookings/${b2.bookingId}/fcApprovalId`);
  await expectFail('Wrong FC student answers', call('fc', 'respondFcApproval', { approvalId: fa, decision: 'approve' }));
  await expectOk('Named FC student approves', call('fc2', 'respondFcApproval', { approvalId: fa, decision: 'approve' }));
  check('→ waiting for the Dept CC', (await adminGet(`bookings/${b2.bookingId}/status`)) === 'PENDING_DEPT_CC');
  await expectFail('FC-CC approves before the Dept CC', call('fccc', 'adminBookingDecision', { bookingId: b2.bookingId, decision: 'approve' }), /Dept CC must approve/);
  await expectFail('FD student asks for the FC camera', call('other', 'createBooking', base(D2, 19, 20, { equipment: ['photoLab', 'camera'], fcStudentNiftId: U.fc2.niftId })), /not issued/i);

  console.log('\nFirst-year, faculty, special');
  await expectFail('First-year without senior', call('first', 'createBooking', base(D2, 19, 20)), /first-year|senior/i);
  const b3 = await expectOk('First-year with senior', call('first', 'createBooking', base(D2, 19, 20, { seniorNiftId: U.fc.niftId })));
  const note = await adminGet(`facultyNotifications/${b3.bookingId}`);
  check('faculty notification stored', note?.facultyEmail === U.fac.email);
  // The faculty link token is only in the (unsent) email; use the stored hash flow via a fresh token.
  const tok = 'zz-test-token-1234567890';
  await adb.ref(`facultyNotifications/${b3.bookingId}/tokenHash`).set(require('node:crypto').createHash('sha256').update(tok).digest('hex'));
  await expectFail('Someone else uses the faculty link', call('fc4', 'facultyRespond', { bookingId: b3.bookingId, token: tok, remarks: 'x' }));
  await expectOk('Faculty: "I DID NOT APPROVE THIS"', call('fac', 'facultyRespond', { bookingId: b3.bookingId, token: tok, remarks: 'Not informed' }));
  check('→ FACULTY_CONCERN', (await adminGet(`bookings/${b3.bookingId}/status`)) === 'FACULTY_CONCERN');
  await expectOk('FC-CC rejects after the concern', call('fccc', 'resolveFacultyConcern', { bookingId: b3.bookingId, decision: 'reject', remarks: 'Faculty did not agree' }));

  const sp = await expectOk('Special booking (after 10 PM)', call('fc3', 'createBooking', base(D1, 22, 23)));
  check('→ straight to the FC-CC (no printing)', (await adminGet(`bookings/${sp.bookingId}/status`)) === 'PENDING_FCCC_APPROVAL');
  await expectFail('FC Lab Assistant approves it', call('staff', 'adminBookingDecision', { bookingId: sp.bookingId, decision: 'approve' }), /FC-CC/);
  await expectOk('FC-CC approves', call('fccc', 'adminBookingDecision', { bookingId: sp.bookingId, decision: 'approve' }));
  check('→ waiting for the Director', (await adminGet(`bookings/${sp.bookingId}/status`)) === 'PENDING_DIRECTOR');

  console.log('\nCancel & 4-day block');
  const b4 = await expectOk('Student books', call('fc4', 'createBooking', base(D2, 20, 21)));
  await expectFail('Another student cancels it', call('fc', 'cancelBooking', { bookingId: b4.bookingId }));
  const c4 = await expectOk('Owner cancels a pending booking days ahead', call('fc4', 'cancelBooking', { bookingId: b4.bookingId, reason: 'test' }));
  check('→ no block (pending, not close to the start)', !c4?.blockedUntil);
  // A block as if an approved booking was cancelled close to its start:
  await adb.ref(`users/${U.fc4.uid}/bookingBlock`).set({ until: Date.now() + 86400000, bookingId: b4.bookingId, at: Date.now(), days: 4 });
  await expectFail('Blocked student books again', call('fc4', 'createBooking', base(D2, 20, 21)), /As you cancelled/);

  console.log('\nCheating with direct database writes (must all be DENIED)');
  const { ref, set, update, get, remove } = fdb;
  await expectFail('Student marks own booking APPROVED', raw('fc', () => update(ref(db, `bookings/${b1.bookingId}`), { status: 'APPROVED' })));
  await expectFail('Student makes themself Main Admin', raw('fc', () => set(ref(db, `roles/${U.fc.uid}`), { role: 'main' })));
  await expectFail('Student reads all users (phones, emails)', raw('fc', () => get(ref(db, 'users'))));
  await expectFail('Student reads another student\'s profile', raw('fc', () => get(ref(db, `users/${U.fc2.uid}`))));
  await expectFail('Student deletes someone else\'s slot', raw('fc4', () => remove(ref(db, `bookingSlots/${D1}/h17`))));
  await expectFail('Student overwrites a taken hour', raw('fc4', () => set(ref(db, `bookingSlots/${D1}/h18`), { bookingId: 'FC-000000-0001', status: 'SUBMITTED', uid: U.fc4.uid })));
  await expectFail('Student creates a booking already APPROVED', raw('fc2', () => set(ref(db, 'bookings/FC-991231-0001'), { id: 'FC-991231-0001', studentUid: U.fc2.uid, email: U.fc2.email, studentType: 'FC_STUDENT', status: 'APPROVED', date: D3, startHour: 18, endHour: 19, startAt: cal.slotStartMs(D3, 18) })));
  await expectFail('Student creates a 10-hour booking directly', raw('fc2', () => set(ref(db, 'bookings/FC-991231-0002'), { id: 'FC-991231-0002', studentUid: U.fc2.uid, email: U.fc2.email, studentType: 'FC_STUDENT', status: 'PENDING_FCCC_APPROVAL', date: D3, startHour: 9, endHour: 19, startAt: cal.slotStartMs(D3, 9) })));
  await expectFail('Blocked student writes a booking directly', raw('fc4', () => set(ref(db, 'bookings/FC-991231-0003'), { id: 'FC-991231-0003', studentUid: U.fc4.uid, email: U.fc4.email, studentType: 'FC_STUDENT', status: 'PENDING_FCCC_APPROVAL', date: D3, startHour: 21, endHour: 22, startAt: cal.slotStartMs(D3, 21) })));
  await expectFail('Blocked student removes their block', raw('fc4', () => remove(ref(db, `users/${U.fc4.uid}/bookingBlock`))));
  await expectFail('Student changes own student type', raw('other', () => update(ref(db, `users/${U.other.uid}`), { studentType: 'FC_STUDENT' })));
  await expectFail('Student changes settings', raw('fc', () => update(ref(db, 'settings/bookingRules'), { maxDurationHours: 12 })));
  await expectFail('Student opens a holiday / slot override', raw('fc', () => set(ref(db, `settings/availabilityOverrides/${D3}/h10`), { type: 'open' })));
  await expectFail('Student adds an FC-CC approval to own booking', raw('fc2', () => update(ref(db, `bookings/${b2.bookingId}`), { status: 'CANCELLED_BY_STUDENT', fcccApproval: { at: 1, byName: 'Fake' } })));
  await expectFail('FC Lab Assistant edits the admin list', raw('staff', () => set(ref(db, `roles/${U.fc.uid}`), { role: 'fccc' })));
  await expectFail('Student writes a Dept CC approval on their own booking', raw('other', () => update(ref(db, `bookings/${b2.bookingId}`), { deptCcApproval: { decision: 'approve', at: 1, byName: 'Fake CC' } })));
  await expectFail('Student skips the Dept CC (sets FC-CC step)', raw('other', () => update(ref(db, `bookings/${b2.bookingId}`), { status: 'PENDING_FCCC_APPROVAL' })));
  await expectFail('Student writes a Director approval', raw('fc3', () => update(ref(db, `bookings/${sp.bookingId}`), { directorApproval: { decision: 'approve', at: 1 }, status: 'APPROVED' })));
  await expectFail('FC student marks the booking APPROVED', raw('fc2', () => update(ref(db, `bookings/${b2.bookingId}`), { status: 'APPROVED' })));
  await expectFail('Student reads the one-click link store', raw('fc', () => get(ref(db, 'decisionTokens'))));
  await expectFail('Student writes a one-click link', raw('fc', () => set(ref(db, `decisionTokens/${b2.bookingId}/deptCc`), { hash: 'x' })));
  await expectFail('Student reads the settings of other admins (roles)', raw('fc', () => get(ref(db, 'roles'))));
  await expectFail('Student books for tomorrow at a closed hour (rules check the time too)', raw('fc2', () => set(ref(db, 'bookings/FC-991231-0009'), { id: 'FC-991231-0009', studentUid: U.fc2.uid, email: U.fc2.email, studentType: 'FC_STUDENT', status: 'PENDING_FCCC_APPROVAL', date: today, startHour: 9, endHour: 10, startAt: Date.now() - 1000 })));
  // Slot alerts ("notify me if it frees up"): each student only touches their own list.
  const W = { date: D3, hour: 20, email: U.fc.email, name: 'Test', at: 1 };
  await expectOk('Student saves own slot alert', raw('fc', () => set(ref(db, `slotWatch/${U.fc.uid}/${D3}_h20`), W)));
  await expectFail("Student reads another student's slot alerts", raw('fc2', () => get(ref(db, `slotWatch/${U.fc.uid}`))));
  await expectFail("Student adds an alert to another student's list", raw('fc2', () => set(ref(db, `slotWatch/${U.fc.uid}/${D3}_h21`), { ...W, email: U.fc2.email })));
  await expectFail('Student saves an alert with another student email', raw('fc2', () => set(ref(db, `slotWatch/${U.fc2.uid}/${D3}_h21`), W)));
  await expectFail('Student reads every slot alert', raw('fc', () => get(ref(db, 'slotWatch'))));
  await expectFail('Not signed-in user reads bookings', (async () => { await auth.signOut(); current = null; return get(ref(db, 'bookingSlots')); })());

  console.log('\nSame slot at the same time — 4 students, 4 separate processes');
  const startAt = Date.now() + 30000;
  const racers = ['fc', 'fc2', 'fc3', 'other'];
  const results = await Promise.all(racers.map((k) => new Promise((resolve) => {
    const payload = JSON.stringify(base(D2, 21, 22, k === 'other' ? { fcStudentNiftId: U.fc.niftId } : {}));
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', k, payload, String(startAt)], { env: process.env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      resolve(line ? JSON.parse(line.slice(7)) : { ok: false, error: 'worker crashed' });
    });
  })));
  const winners = results.filter((r) => r.ok).length;
  results.forEach((r, i) => console.log(`    ${racers[i]}: ${r.ok ? `BOOKED ${r.r.bookingId}` : r.error}`));
  check(`exactly 1 of 4 simultaneous bookings wins (got ${winners})`, winners === 1);
  const day = (await adminGet(`bookingSlots/${D2}`)) || {};
  check('the hour holds exactly one booking', Boolean(day.h21?.bookingId));

  console.log('\nAutomatic jobs & storage');
  await as('staff');
  const m = await expectOk('Daily maintenance (size estimate)', runMaintenance({ force: true }));
  check(`database usage estimate works (${m?.usage?.percent ?? '?'} % of 1 GB)`, typeof m?.usage?.percent === 'number' && m.usage.percent < 5);
} catch (e) {
  bad('live test crashed', e.stack || e.message);
} finally {
  try {
    const { auth } = await vite.ssrLoadModule('/src/firebase.js');
    await auth.signOut().catch(() => {});
  } catch { /* ignore */ }
  console.log(`\nCleanup: ${await cleanup()}, test accounts deleted`);
  await vite.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) console.log(failures.map((f) => ` - ${f}`).join('\n'));
process.exit(failures.length ? 1 : 0);
