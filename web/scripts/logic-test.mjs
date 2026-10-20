// End-to-end logic tests: runs the REAL backend code (functions/src) against the
// in-memory database through Vite's demo aliases. No Firebase project needed.
//   npm --prefix web run test:logic
import zlib from 'node:zlib';
import { createServer } from 'vite';

// ---- browser globals the demo store expects ----
const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
};
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
void zlib;

const root = new URL('..', import.meta.url);
const vite = await createServer({
  root: root.pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  mode: 'demo',
  configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
});

let passed = 0;
const failures = [];
const ok = (label) => { passed++; console.log(`  ✓ ${label}`); };
const bad = (label, why) => { failures.push(`${label} — ${why}`); console.log(`  ✗ ${label} — ${why}`); };
const check = (label, cond, why = 'assertion failed') => (cond ? ok(label) : bad(label, why));

try {
  const { demoCall } = await vite.ssrLoadModule('/src/demo/server.js');
  const { accountByUid } = await vite.ssrLoadModule('/src/demo/session.js');
  const { store } = await vite.ssrLoadModule('/src/demo/store.js');
  const fns = await vite.ssrLoadModule('/../functions/src/index.js');
  const cal = await vite.ssrLoadModule('@shared/calendar.js');
  const C = await vite.ssrLoadModule('@shared/constants.js');
  const { STATUS } = C;

  const call = (name, data, uid) => demoCall(name, data, { as: accountByUid(uid), latency: 0 });
  const expectOk = async (label, p) => {
    try {
      const r = await p;
      ok(label);
      return r;
    } catch (e) {
      bad(label, `unexpected error: ${e.message}`);
      return null;
    }
  };
  const expectFail = async (label, p, re) => {
    try {
      await p;
      bad(label, 'was allowed but should fail');
    } catch (e) {
      if (re && !re.test(e.message)) bad(label, `wrong error: ${e.message}`);
      else ok(`${label} → "${e.message.slice(0, 80)}"`);
    }
  };
  const booking = (id) => store.getRaw(`bookings/${id}`);
  // Same database changes the Google Sheet makes when the Dept CC / Director decides (tested separately).
  const emailDecision = (id, step, decision, remarks = 'Checked') => {
    const b = booking(id);
    const now = Date.now();
    const next = decision === 'approve' ? (step === 'director' ? STATUS.APPROVED : STATUS.PENDING_FCCC_APPROVAL) : STATUS.REJECTED;
    const label = step === 'director' ? 'Director' : `${b.department} CC`;
    store.update(`bookings/${id}`, {
      status: next,
      [step === 'director' ? 'directorApproval' : 'deptCcApproval']: { decision, byName: label, at: now, remarks, ...(decision === 'approve' ? { signature: { digital: true, name: label, role: label, at: now, code: 'FPL-NJ-00000000' } } : {}) },
    });
    for (let h = b.startHour; h < b.endHour; h++) {
      const k = `bookingSlots/${b.date}/${cal.slotKey(h)}`;
      if (decision === 'approve') store.update(k, { status: next }); else store.set(k, null);
    }
  };

  // ---- dates ----
  const today = cal.todayIST();
  const ahead = [1, 2, 3, 4, 5, 6].map((n) => cal.addDays(today, n));
  const weekdays = ahead.filter((d) => ![0, 6].includes(cal.dayOfWeek(d)));
  const weekend = ahead.filter((d) => [0, 6].includes(cal.dayOfWeek(d)));
  const [D1, D2, D3] = weekdays;
  const DH = weekdays[weekdays.length - 1]; // holiday test day (unused elsewhere)
  const WE = weekend[0];

  const FAC = { facultyName: 'Dr. Anjali Rao', facultyEmail: 'anjali.rao@nift.ac.in' };
  const base = (date, s, e, extra = {}) => ({
    date, startHour: s, endHour: e, purpose: 'Test shoot', equipment: ['photoLab'],
    answers: { q_team: 1 }, confirmations: { c_agree: true }, signDigitally: true, ...FAC,
    participants: [{ name: 'Test Person One', department: 'FC', hostel: 'Boys Hostel', room: '101' }, { name: 'Test Person Two', department: 'FD', hostel: 'Girls Hostel', room: '202' }],
    ...extra,
  });

  // ---- setup ----
  console.log('\nSetup');
  await call('syncAccount', {}, 'demo-main');
  await call('setAdminRole', { email: 'prakash.choudhary@nift.ac.in', role: 'staff' }, 'demo-main');
  await call('setAdminRole', { email: 'meera.iyer@nift.ac.in', role: 'fccc' }, 'demo-main');
  for (const u of ['demo-staff', 'demo-fccc']) await call('syncAccount', {}, u);
  for (const u of ['demo-fc', 'demo-fc2', 'demo-fc3', 'demo-other', 'demo-fd', 'demo-idm', 'demo-first', 'demo-grad', 'demo-ad']) {
    const a = accountByUid(u);
    await call('syncAccount', {}, u);
    await call('registerStudent', { name: a.name, ...a.profile }, u);
  }
  await call('updateStudent', { niftId: 'FC/22/011', status: 'GRADUATED', remarks: 'test' }, 'demo-staff');
  // Tests run at any time of day: relax booking hours / weekly limits (each is tested on purpose below).
  const RELAX = { regularBookingOpenHour: 0, regularBookingCloseHour: 24, specialBookingOpenHour: 0, specialBookingCloseHour: 24, specialMinNoticeHours: 0, weeklyMaxBookings: 0, weeklyMaxHours: 0 };
  store.update('settings/bookingRules', RELAX);
  ok(`accounts ready · dates D1=${D1} D2=${D2} D3=${D3} WE=${WE} holiday=${DH}`);
  await expectFail('Same NIFT ID cannot register twice', call('registerStudent', { name: 'Fake Aarav', niftId: 'FC/23/014', department: 'FC', semester: 6, phone: '+91 90000 00000' }, 'demo-new'), /already registered/);

  // ---- 1. Same time, same slot ----
  console.log('\n1. Booking the same slot at the same time');
  const race1 = await Promise.allSettled([
    call('createBooking', base(D1, 17, 19), 'demo-fc'),
    call('createBooking', base(D1, 18, 20), 'demo-fc2'),
    call('createBooking', base(D1, 17, 18, { fcStudentNiftId: 'FC/23/031' }), 'demo-other'),
  ]);
  // 5–7 PM overlaps both others; 6–8 PM and 5–6 PM don't overlap each other.
  const wins1 = race1.map((r, i) => (r.status === 'fulfilled' ? [[17, 19], [18, 20], [17, 18]][i] : null)).filter(Boolean);
  const clash = wins1.some((a, i) => wins1.some((b, j) => i < j && a[0] < b[1] && b[0] < a[1]));
  check(`3 overlapping bookings at once → ${wins1.length} accepted, none overlapping`, wins1.length >= 1 && !clash);
  race1.filter((r) => r.status === 'rejected').forEach((r) => check('the other student gets a clear "just booked" message', /just been booked|already/i.test(r.reason.message), r.reason.message));

  const five = ['demo-fc', 'demo-fc2', 'demo-fc3', 'demo-idm', 'demo-fd'];
  const race2 = await Promise.allSettled(five.map((u) =>
    call('createBooking', base(D1, 20, 21, u === 'demo-fd' ? { fcStudentNiftId: 'FC/23/014' } : {}), u)));
  const wins2 = race2.filter((r) => r.status === 'fulfilled').length;
  check(`5 students click the same 1-hour slot together → exactly 1 wins (got ${wins2})`, wins2 === 1);

  const dup = await Promise.allSettled([1, 2, 3].map(() => call('createBooking', base(D1, 21, 22), 'demo-fc')));
  check(`same student double-clicks Submit 3× → exactly 1 booking (got ${dup.filter((r) => r.status === 'fulfilled').length})`, dup.filter((r) => r.status === 'fulfilled').length === 1);

  // ---- 2. Booking rules ----
  console.log('\n2. Booking rules');
  const fc4 = await expectOk('FC student books 4 hours', call('createBooking', base(D2, 17, 21), 'demo-fc'));
  check('normal booking waits for FC-CC', booking(fc4?.bookingId)?.status === STATUS.PENDING_FCCC_APPROVAL);
  check('student signature is a digital stamp (FPL-NJ code, no image)', booking(fc4?.bookingId)?.signature?.digital === true && /^FPL-NJ-[0-9A-F]{8}$/.test(booking(fc4?.bookingId)?.signature?.code) && !booking(fc4?.bookingId)?.signature?.path);
  await expectFail('FC student 5 hours', call('createBooking', base(WE, 12, 17), 'demo-fc2'), /4 hour|maximum/i);
  await expectFail('Other department 4 hours', call('createBooking', base(WE, 17, 21, { fcStudentNiftId: 'FC/23/014' }), 'demo-other'), /3 hour|maximum/i);
  const oth3 = await expectOk('Other department 3 hours (with FC student)', call('createBooking', base(D3, 18, 21, { fcStudentNiftId: 'FC/23/014' }), 'demo-other'));
  check('other dept waits for FC student first', booking(oth3?.bookingId)?.status === STATUS.PENDING_FC_APPROVAL);
  await expectFail('Other department without FC student', call('createBooking', base(D3, 21, 22), 'demo-fd'), /FC student/i);
  await expectFail('Other department asks for the FC camera', call('createBooking', base(D3, 21, 22, { equipment: ['photoLab', 'camera'], fcStudentNiftId: 'FC/23/014' }), 'demo-fd'), /not issued/i);
  await expectFail('Not signed digitally', call('createBooking', base(D3, 21, 22, { signDigitally: false }), 'demo-fc2'), /sign this booking digitally/i);
  await expectFail('No faculty name/email', call('createBooking', base(D3, 21, 22, { facultyName: '', facultyEmail: '' }), 'demo-fc2'), /faculty/i);
  await expectFail('CLS class hours (10 AM–12 PM weekday)', call('createBooking', base(D2, 10, 12), 'demo-fc2'));
  await expectFail('Date in the past', call('createBooking', base(cal.addDays(today, -1), 17, 18), 'demo-fc2'));
  await expectFail('More than 7 days ahead', call('createBooking', base(cal.addDays(today, 10), 17, 18), 'demo-fc2'));
  await expectFail('First-year without senior', call('createBooking', base(D3, 17, 18), 'demo-first'), /first-year|senior/i);
  await expectFail('First-year with a junior as senior', call('createBooking', base(D3, 17, 18, { seniorNiftId: 'FC/26/007' }), 'demo-first'));
  const fy = await expectOk('First-year with a senior (Sem 6)', call('createBooking', base(D3, 17, 18, { seniorNiftId: 'FC/23/014' }), 'demo-first'));
  await expectFail('Graduated student', call('createBooking', base(D3, 21, 22), 'demo-grad'), /graduated/i);
  await expectFail('Not signed in', demoCall('createBooking', base(D3, 21, 22), { as: null, latency: 0 }).catch((e) => { throw e; }));

  // ---- 3. Approvals (only the FC-CC) ----
  console.log('\n3. Approvals — only the FC-CC decides');
  await expectFail('FC Lab Assistant tries to approve', call('adminBookingDecision', { bookingId: fc4.bookingId, decision: 'approve' }, 'demo-staff'), /FC-CC/);
  await expectFail('Student tries to approve own booking', call('adminBookingDecision', { bookingId: fc4.bookingId, decision: 'approve' }, 'demo-fc'));
  await expectFail('FC-CC rejects without a reason', call('adminBookingDecision', { bookingId: fc4.bookingId, decision: 'reject' }, 'demo-fccc'), /reason/i);
  await expectOk('FC-CC signs & approves', call('adminBookingDecision', { bookingId: fc4.bookingId, decision: 'approve', remarks: 'ok' }, 'demo-fccc'));
  const ap = booking(fc4.bookingId);
  check('status APPROVED', ap.status === STATUS.APPROVED);
  check('FC-CC digital stamp saved (name, FC-CC, FPL-NJ code)', ap.fcccApproval?.signature?.digital && ap.fcccApproval.signature.role === 'FC-CC' && /^FPL-NJ-/.test(ap.fcccApproval.signature.code));
  check('slots show APPROVED', Object.values(store.getRaw(`bookingSlots/${D2}`) || {}).filter((s) => s.bookingId === fc4.bookingId).every((s) => s.status === STATUS.APPROVED));
  await expectFail('Approve twice', call('adminBookingDecision', { bookingId: fc4.bookingId, decision: 'approve' }, 'demo-fccc'));
  await expectOk('FC-CC approves the first-year booking', call('adminBookingDecision', { bookingId: fy.bookingId, decision: 'approve' }, 'demo-fccc'));

  // ---- 4. FC student approval ----
  console.log('\n4. FC student approval (other departments)');
  const appr = booking(oth3.bookingId).fcApprovalId;
  await expectFail('Wrong FC student answers', call('respondFcApproval', { approvalId: appr, decision: 'approve' }, 'demo-fc2'), /another student/i);
  await expectOk('Named FC student approves', call('respondFcApproval', { approvalId: appr, decision: 'approve' }, 'demo-fc'));
  check('→ waiting for the Dept CC (BFT CC)', booking(oth3.bookingId).status === STATUS.PENDING_DEPT_CC);
  await expectFail('FC-CC cannot approve before the Dept CC', call('adminBookingDecision', { bookingId: oth3.bookingId, decision: 'approve' }, 'demo-fccc'), /Dept CC must approve/);
  await expectFail('Re-send the Dept CC email without the Google Sheet set up', call('resendDecisionEmail', { bookingId: oth3.bookingId }, 'demo-staff'), /not set up/);
  await expectFail('FC student answers twice', call('respondFcApproval', { approvalId: appr, decision: 'reject', reason: 'x' }, 'demo-fc'), /already/i);

  const r2 = await expectOk('Other dept books WE 15–17 with FC student', call('createBooking', base(WE, 15, 17, { fcStudentNiftId: 'FC/24/022' }), 'demo-ad'));
  await expectOk('FC student rejects', call('respondFcApproval', { approvalId: booking(r2.bookingId).fcApprovalId, decision: 'reject', reason: 'Not my shoot' }, 'demo-fc2'));
  check('→ REJECTED and slot freed', booking(r2.bookingId).status === STATUS.REJECTED && !Object.values(store.getRaw(`bookingSlots/${WE}`) || {}).some((s) => s.bookingId === r2.bookingId));
  await expectOk('Someone else can now book that freed slot', call('createBooking', base(WE, 15, 17), 'demo-fc3'));

  // ---- 5. Cancelling ----
  console.log('\n5. Cancelling');
  const mine = await expectOk('Meghna books D2 21–22', call('createBooking', base(D2, 21, 22), 'demo-fc3'));
  await expectFail('Another student cancels it', call('cancelBooking', { bookingId: mine.bookingId }, 'demo-fc'));
  await expectFail('FC Lab Assistant cancels it (FC-CC only)', call('cancelBooking', { bookingId: mine.bookingId, reason: 'x' }, 'demo-staff'));
  const early = await expectOk('Meghna books and cancels while still pending', call('createBooking', base(DH, 20, 21), 'demo-fc3'));
  const ce = await expectOk('Cancel a pending booking', call('cancelBooking', { bookingId: early.bookingId }, 'demo-fc3'));
  check('→ no block for cancelling a pending booking', !ce?.blockedUntil && !store.getRaw('users/demo-fc3/bookingBlock'));
  await call('adminBookingDecision', { bookingId: mine.bookingId, decision: 'approve' }, 'demo-fccc');
  store.update('settings/bookingRules', { cancelBlockWithinHours: 1 });
  const far = await expectOk('Approved booking cancelled long before the start', call('cancelBooking', { bookingId: (await call('createBooking', base(DH, 21, 22), 'demo-fc3').then(async (r) => { await call('adminBookingDecision', { bookingId: r.bookingId, decision: 'approve' }, 'demo-fccc'); return r; })).bookingId }, 'demo-fc3'));
  check('→ no block (more than the block window before the start)', !far?.blockedUntil);
  store.update('settings/bookingRules', { cancelBlockWithinHours: 720 });
  const cr = await expectOk('Owner cancels an APPROVED booking close to its start', call('cancelBooking', { bookingId: mine.bookingId, reason: 'Model unavailable' }, 'demo-fc3'));
  check('admin.jodhpur told the approved booking is cancelled', Object.values(store.getRaw('demoOutbox') || {}).some((m) => m.to.includes('admin.jodhpur@nift.ac.in') && m.subject.startsWith('CANCELLED') && m.subject.includes(mine.bookingId)));
  check('→ CANCELLED_BY_STUDENT, slot freed', booking(mine.bookingId).status === STATUS.CANCELLED_BY_STUDENT && !Object.values(store.getRaw(`bookingSlots/${D2}`) || {}).some((s) => s.bookingId === mine.bookingId));
  check('4-day block started', cr?.blockedUntil > Date.now() + 3.9 * 86400000);
  await expectFail('Blocked student books again', call('createBooking', base(D3, 21, 22), 'demo-fc3'), /As you cancelled booking/);
  await expectOk('Staff books for the blocked student (exception)', call('createBooking', base(D2, 21, 22, { onBehalfOfNiftId: 'FC/23/031', remarks: 'Counter booking' }), 'demo-staff'));
  await expectOk('Staff lifts the block', call('updateStudent', { niftId: 'FC/23/031', clearBookingBlock: true, remarks: 'ok' }, 'demo-staff'));
  await expectOk('Student can book again after lift', call('createBooking', base(D3, 21, 22), 'demo-fc3'));
  await expectOk('FC-CC cancels an approved booking', call('cancelBooking', { bookingId: fy.bookingId, reason: 'Lab needed' }, 'demo-fccc'));
  check('→ CANCELLED_BY_ADMIN, no block for student', booking(fy.bookingId).status === STATUS.CANCELLED_BY_ADMIN && !store.getRaw('users/demo-first/bookingBlock'));

  // ---- 6. Special approval ----
  console.log('\n6. Special approval (weekend)');
  await expectFail('Special booking without the people list', call('createBooking', base(WE, 9, 12, { participants: [] }), 'demo-fc'), /every person/i);
  await expectFail('Special booking: a person without hostel/room', call('createBooking', base(WE, 9, 12, { participants: [{ name: 'Some One', department: 'FC', hostel: '', room: '' }] }), 'demo-fc'), /hostel/i);
  const sp = await expectOk('FC student books weekend 9–12 with 2 people', call('createBooking', base(WE, 9, 12), 'demo-fc'));
  check('people list stored (name, dept, hostel, room)', booking(sp.bookingId)?.participants?.length === 2 && booking(sp.bookingId).participants[1].room === '202');
  check('number of people = list length', booking(sp.bookingId)?.answers?.q_team?.value === 2);
  check('normal bookings store the people list too', booking(fc4.bookingId)?.participants?.length === 2);
  check('special FC booking → straight to the FC-CC (no printing)', booking(sp.bookingId).status === STATUS.PENDING_FCCC_APPROVAL && booking(sp.bookingId).isSpecial === true);
  await expectFail('FC Lab Assistant approves the special booking', call('adminBookingDecision', { bookingId: sp.bookingId, decision: 'approve' }, 'demo-staff'), /FC-CC/);
  await expectOk('FC-CC approves & signs', call('adminBookingDecision', { bookingId: sp.bookingId, decision: 'approve' }, 'demo-fccc'));
  check('→ now with the Director (FC-CC stamp saved)', booking(sp.bookingId).status === STATUS.PENDING_DIRECTOR && /^FPL-NJ-/.test(booking(sp.bookingId).fcccApproval?.signature?.code || ''));
  check('student told "FC-CC approved — now with the Director"', Object.values(store.getRaw('demoOutbox') || {}).some((m) => m.subject.startsWith('FC-CC approved') && m.subject.includes(sp.bookingId)));
  check('admin.jodhpur NOT told yet (Director still to approve)', !Object.values(store.getRaw('demoOutbox') || {}).some((m) => m.to.includes('admin.jodhpur@nift.ac.in') && m.subject.includes(sp.bookingId)));
  await expectFail('FC-CC approves again', call('adminBookingDecision', { bookingId: sp.bookingId, decision: 'approve' }, 'demo-fccc'), /with the Director/);
  emailDecision(sp.bookingId, 'director', 'approve');
  check('Director approves by email → APPROVED', booking(sp.bookingId).status === STATUS.APPROVED);
  const notice = Object.values(store.getRaw('demoOutbox') || {}).find((m) => m.to.includes('admin.jodhpur@nift.ac.in') && m.subject.includes(fc4.bookingId));
  check('admin.jodhpur told about FC-CC approvals with every person, hostel and room', Boolean(notice) && /Test Person Two · FD · Girls Hostel, Room 202/.test(notice.text));

  console.log('\n6b. Other department, special: FC student → Dept CC → FC-CC → Director');
  const os1 = await expectOk('FD student books weekend 12–14 (special) with an FC student', call('createBooking', base(WE, 12, 14, { fcStudentNiftId: 'FC/23/014' }), 'demo-fd'));
  await expectOk('FC student approves', call('respondFcApproval', { approvalId: booking(os1?.bookingId)?.fcApprovalId, decision: 'approve' }, 'demo-fc'));
  check('→ Dept CC', booking(os1.bookingId).status === STATUS.PENDING_DEPT_CC);
  emailDecision(os1.bookingId, 'deptCc', 'approve');
  check('Dept CC approves by email → FC-CC', booking(os1.bookingId).status === STATUS.PENDING_FCCC_APPROVAL);
  await expectOk('FC-CC approves', call('adminBookingDecision', { bookingId: os1.bookingId, decision: 'approve' }, 'demo-fccc'));
  check('→ Director', booking(os1.bookingId).status === STATUS.PENDING_DIRECTOR);
  emailDecision(os1.bookingId, 'director', 'reject', 'Not this weekend');
  check('Director rejects → REJECTED and the slot is free again', booking(os1.bookingId).status === STATUS.REJECTED && !Object.values(store.getRaw(`bookingSlots/${WE}`) || {}).some((x) => x.bookingId === os1.bookingId));

  // ---- 7. Faculty "I DID NOT APPROVE THIS" ----
  console.log('\n7. Faculty concern');
  const mail = Object.values(store.getRaw('demoOutbox') || {}).find((m) => m.subject.includes(fc4.bookingId) && m.subject.includes('Information'));
  const token = /[?&]t=([A-Za-z0-9_-]+)/.exec(mail?.text || '')?.[1];
  check('faculty got an information email with a response link', Boolean(token));
  await expectFail('Someone else uses the faculty link', call('facultyRespond', { bookingId: fc4.bookingId, token, remarks: 'x' }, 'demo-fc2'), /sent to/i);
  await expectOk('Faculty says "I did not approve this"', call('facultyRespond', { bookingId: fc4.bookingId, token, remarks: 'Not informed' }, 'demo-faculty'));
  check('→ FACULTY_CONCERN', booking(fc4.bookingId).status === STATUS.FACULTY_CONCERN);
  await expectFail('Faculty responds twice', call('facultyRespond', { bookingId: fc4.bookingId, token, remarks: 'again' }, 'demo-faculty'), /already/i);
  await expectFail('FC Lab Assistant decides the concern (FC-CC only)', call('resolveFacultyConcern', { bookingId: fc4.bookingId, decision: 'approve', remarks: 'x' }, 'demo-staff'));
  await expectOk('FC-CC keeps the booking', call('resolveFacultyConcern', { bookingId: fc4.bookingId, decision: 'approve', remarks: 'Checked' }, 'demo-fccc'));
  check('→ back to APPROVED', booking(fc4.bookingId).status === STATUS.APPROVED);

  // ---- 8. Calendar controls ----
  console.log('\n8. Holidays & overrides');
  await expectFail('Student sets a holiday', call('setHoliday', { date: DH, name: 'x', open: false }, 'demo-fc'));
  await expectOk('Staff closes a holiday', call('setHoliday', { date: DH, name: 'Test holiday', open: false }, 'demo-staff'));
  await expectFail('Booking on the holiday', call('createBooking', base(DH, 17, 18), 'demo-fc2'));
  await expectOk('Staff opens CLS hours 3–5 PM', call('setSlotOverride', { date: D3, hours: [15, 16], type: 'open', reason: 'free' }, 'demo-staff'));
  await expectOk('Booking in the opened CLS slot', call('createBooking', base(D3, 15, 17), 'demo-fc2'));

  // ---- 9. Scheduled jobs ----
  console.log('\n9. Automatic jobs');
  const past = (id, daysAgo) => {
    const b = booking(id);
    const d = cal.addDays(today, -daysAgo);
    store.update(`bookings/${id}`, { date: d, startAt: cal.slotStartMs(d, b.startHour), endAt: cal.slotStartMs(d, b.endHour) });
  };
  past(fc4.bookingId, 1); // approved → should complete
  past(oth3.bookingId, 1); // pending FC-CC → should expire
  await fns.completeBookings.__schedule();
  check('approved booking in the past → COMPLETED', booking(fc4.bookingId).status === STATUS.COMPLETED);
  check('pending booking in the past → REJECTED (expired)', booking(oth3.bookingId).status === STATUS.REJECTED && booking(oth3.bookingId).rejection?.expired);

  // ---- 10. FC-IDM request, staff answering for the FC student, equipment ----
  console.log('\n10. FC-IDM request · staff for FC student · equipment check-out');
  await call('syncAccount', {}, 'demo-new');
  await expectOk('Other-dept student registers and ticks "I am FC-IDM"', call('registerStudent', { name: 'New Student', niftId: 'FD/25/077', department: 'FD', semester: 3, phone: '+91 90000 11111', idmRequest: true }, 'demo-new'));
  const nu = store.getRaw('users/demo-new');
  check('stays other-department until staff confirm; request PENDING', nu.studentType === 'OTHER_DEPT_STUDENT' && nu.idmRequest?.state === 'PENDING');
  check('no email about the FC-IDM request (dashboard only)', !Object.values(store.getRaw('demoOutbox') || {}).some((m) => /FC-IDM/.test(m.subject)));
  await expectFail('Student confirms their own FC-IDM request', call('updateStudent', { niftId: 'FD/25/077', idmDecision: 'approve' }, 'demo-new'));
  await expectOk('Staff confirm FC-IDM', call('updateStudent', { niftId: 'FD/25/077', idmDecision: 'approve', remarks: 'IDM list checked' }, 'demo-staff'));
  check('→ FC-IDM student, request APPROVED, no email', store.getRaw('users/demo-new/studentType') === 'FC_IDM_STUDENT' && store.getRaw('users/demo-new/idmRequest/state') === 'APPROVED'
    && !Object.values(store.getRaw('demoOutbox') || {}).some((m) => /FC-IDM/.test(m.subject)));
  await call('syncAccount', {}, 'demo-ad');
  const fcw = await expectOk('Other-dept booking waits for its FC student', call('createBooking', base(D3, 17, 18, { fcStudentNiftId: 'FC/23/014' }), 'demo-ad'));
  const fcwId = booking(fcw.bookingId).fcApprovalId;
  await expectFail('Another student answers for the FC student', call('respondFcApproval', { approvalId: fcwId, decision: 'approve' }, 'demo-fc2'));
  await expectFail('Staff reject for the FC student without a reason', call('respondFcApproval', { approvalId: fcwId, decision: 'reject' }, 'demo-staff'), /reason/i);
  await expectOk('Staff approve on behalf of the FC student', call('respondFcApproval', { approvalId: fcwId, decision: 'approve' }, 'demo-staff'));
  check('→ Dept CC next, marked "FC staff, for FC student"', booking(fcw.bookingId).status === STATUS.PENDING_DEPT_CC && booking(fcw.bookingId).fcApproval?.onBehalf === true && /FC staff/.test(booking(fcw.bookingId).fcApproval.byName));
  emailDecision(fcw.bookingId, 'deptCc', 'approve');
  await call('adminBookingDecision', { bookingId: fcw.bookingId, decision: 'approve' }, 'demo-fccc');
  check('normal other-department booking: FC-CC is the last step → APPROVED', booking(fcw.bookingId).status === STATUS.APPROVED);
  await expectFail('Student records equipment', call('recordEquipment', { bookingId: fcw.bookingId, action: 'issue' }, 'demo-ad'));
  await expectFail('Return before issue', call('recordEquipment', { bookingId: fcw.bookingId, action: 'return' }, 'demo-staff'), /issued first/i);
  await expectOk('Staff mark equipment issued', call('recordEquipment', { bookingId: fcw.bookingId, action: 'issue' }, 'demo-staff'));
  await expectFail('Returned with a problem but no description', call('recordEquipment', { bookingId: fcw.bookingId, action: 'return', condition: 'issue' }, 'demo-staff'), /describe/i);
  await expectOk('Staff mark returned with a problem', call('recordEquipment', { bookingId: fcw.bookingId, action: 'return', condition: 'issue', note: 'Softbox rod bent' }, 'demo-staff'));
  check('equipment log saved (issued + returned with problem)', booking(fcw.bookingId).equipmentLog?.issued && booking(fcw.bookingId).equipmentLog?.returned?.condition === 'issue');

  // ---- 11. Booking hours and fair-use limits ----
  console.log('\n11. Booking hours · per-day and per-week limits');
  await call('removeHoliday', { date: DH }, 'demo-staff'); // the test holiday from section 8
  store.update('settings/bookingRules', { regularBookingOpenHour: 0, regularBookingCloseHour: 0, bookingHoursWithinDays: 7 });
  await expectFail('Regular booking outside booking hours', call('createBooking', base(DH, 17, 18), 'demo-fc2'), /can only be made between/);
  await expectOk('Staff can still book for a student outside booking hours', call('createBooking', base(DH, 17, 18, { onBehalfOfNiftId: 'FC/24/022' }), 'demo-staff').then(async (r) => { await call('cancelBooking', { bookingId: r.bookingId, reason: 'test' }, 'demo-fccc'); return r; }));
  // Booking hours only for today / tomorrow: closed hours, but a booking 2+ days ahead is fine.
  store.update('settings/bookingRules', { ...RELAX, regularBookingOpenHour: 0, regularBookingCloseHour: 0, specialBookingOpenHour: 0, specialBookingCloseHour: 0, bookingHoursWithinDays: 1 });
  await expectFail('Booking for TOMORROW outside booking hours', call('createBooking', base(cal.addDays(today, 1), 22, 23), 'demo-fc3'), /today or tomorrow/);
  await expectOk(`Booking ${cal.diffDays(today, DH)} days ahead outside booking hours → allowed`, call('createBooking', base(DH, 17, 18), 'demo-fc3').then(async (r) => { await call('cancelBooking', { bookingId: r.bookingId, reason: 'test' }, 'demo-fccc'); return r; }));
  store.update('settings/bookingRules', { ...RELAX, specialBookingOpenHour: 0, specialBookingCloseHour: 0, bookingHoursWithinDays: 7 });
  await expectFail('Special request outside special hours', call('createBooking', base(WE, 21, 23), 'demo-fc2'), /Special bookings .* can only be requested between/);
  store.update('settings/bookingRules', { ...RELAX, specialMinNoticeHours: 400 });
  await expectFail('Special request too late (needs hours ahead)', call('createBooking', base(WE, 21, 23), 'demo-fc2'), /at least 400 hours before/);
  store.update('settings/bookingRules', RELAX);
  const d1 = await expectOk('FC student books 2 h', call('createBooking', base(DH, 17, 19), 'demo-fc2'));
  const d2 = await expectOk('…and another 2 h the same day (4 h total)', call('createBooking', base(DH, 19, 21), 'demo-fc2'));
  await expectFail('…a 5th hour the same day', call('createBooking', base(DH, 21, 22), 'demo-fc2'), /at most 4 hours a day/);
  if (d2) await call('cancelBooking', { bookingId: d2.bookingId, reason: 'test' }, 'demo-fccc'); // free the day again (2 h left)
  const weekOf = () => {
    const from = cal.startOfWeek(DH);
    const to = cal.addDays(from, 6);
    return Object.values(store.getRaw('bookings') || {}).filter((b) => b.studentUid === 'demo-fc2' && C.SLOT_HOLDING_STATUSES.includes(b.status) && b.date >= from && b.date <= to);
  };
  const wk = weekOf();
  store.update('settings/bookingRules', { weeklyMaxBookings: wk.length });
  await expectFail(`Weekly booking limit (limit ${wk.length}, already ${wk.length})`, call('createBooking', base(DH, 21, 22), 'demo-fc2'), /bookings a week/);
  const wkHours = wk.reduce((h, b) => h + b.duration, 0);
  store.update('settings/bookingRules', { weeklyMaxBookings: 0, weeklyMaxHours: wkHours });
  await expectFail(`Weekly hours limit (limit ${wkHours} h, already ${wkHours} h)`, call('createBooking', base(DH, 21, 22), 'demo-fc2'), /hours a week/);
  store.update('settings/bookingRules', RELAX);
  await expectOk('Within all limits again → allowed', call('createBooking', base(DH, 21, 22), 'demo-fc2').then(async (r) => { await call('cancelBooking', { bookingId: r.bookingId, reason: 'test' }, 'demo-fccc'); return r; }));
  for (const r of [d1]) if (r) await call('cancelBooking', { bookingId: r.bookingId, reason: 'test cleanup' }, 'demo-fccc');

  // ---- 12. Data integrity ----
  console.log('\n12. Data integrity');
  const all = store.getRaw('bookings') || {};
  const slots = store.getRaw('bookingSlots') || {};
  let orphan = 0;
  let mismatch = 0;
  for (const [date, day] of Object.entries(slots)) {
    for (const [k, s] of Object.entries(day)) {
      const b = all[s.bookingId];
      if (!b) orphan++;
      else if (b.date !== date && b.status !== STATUS.COMPLETED && b.status !== STATUS.REJECTED) mismatch++;
      else if (b.date === date && (cal.hourFromKey(k) < b.startHour || cal.hourFromKey(k) >= b.endHour)) mismatch++;
    }
  }
  check(`no slot points to a missing booking (orphans: ${orphan})`, orphan === 0);
  check(`no slot belongs to the wrong booking (mismatches: ${mismatch})`, mismatch === 0);
  let missing = 0;
  for (const b of Object.values(all)) {
    if (!C.ACTIVE_STATUSES.includes(b.status)) continue;
    for (let h = b.startHour; h < b.endHour; h++) if (slots[b.date]?.[cal.slotKey(h)]?.bookingId !== b.id) missing++;
  }
  check(`every active booking holds all its hours (missing: ${missing})`, missing === 0);
  const perHour = {};
  for (const b of Object.values(all)) {
    if (!C.ACTIVE_STATUSES.includes(b.status)) continue;
    for (let h = b.startHour; h < b.endHour; h++) {
      const k = `${b.date}/${h}`;
      perHour[k] = (perHour[k] || 0) + 1;
    }
  }
  const doubles = Object.values(perHour).filter((n) => n > 1).length;
  check(`no hour is double-booked (doubles: ${doubles})`, doubles === 0);
  check('no signature images stored', !Object.keys(JSON.parse(localStorage.getItem('fc-demo-files-v14') || '{}')).length);
} catch (e) {
  bad('test run crashed', e.stack || e.message);
} finally {
  await vite.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
