// Seeds the demo with realistic data by calling the REAL backend functions as
// each demo user — so every record goes through production validation.
// Each example is also written to `demoGuide`, shown in the demo bar's "Guide".
import { demoCall } from './server.js';
import { store } from './store.js';
import { accountByUid } from './session.js';
import { todayIST, addDays, dayOfWeek, diffDays, slotStartMs, slotKey, bookingIdFor } from '@shared/calendar.js';
import { STATUS, SLOT_HOLDING_STATUSES } from '@shared/constants.js';

const call = (name, data, uid) => demoCall(name, data, { as: accountByUid(uid), latency: 0 });

function signature(name) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#111';
  ctx.fillStyle = '#111';
  ctx.lineWidth = 2.4;
  ctx.font = 'italic 46px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive';
  ctx.fillText(name, 28, 98);
  ctx.beginPath();
  ctx.moveTo(30, 120);
  for (let x = 30; x < 420; x += 12) ctx.lineTo(x, 118 + Math.sin(x / 14) * 5);
  ctx.stroke();
  return c.toDataURL('image/png');
}

const CONFIRM = { c_agree: true };
const FACULTY = { facultyName: 'Dr. Anjali Rao', facultyEmail: 'anjali.rao@nift.ac.in' };
const FACULTY2 = { facultyName: 'Prof. Sunil Mathur', facultyEmail: 'sunil.mathur@nift.ac.in' };

function booking(name, date, startHour, endHour, purpose, equipment, extra = {}) {
  return {
    date,
    startHour,
    endHour,
    purpose,
    equipment,
    answers: { q_project: extra.project || 'Portfolio', q_team: extra.team || 2 },
    confirmations: CONFIRM,
    signature: signature(name),
    ...FACULTY, // subject / faculty is mandatory
    ...extra,
  };
}

export async function ensureSeeded() {
  const meta = store.getRaw('demoMeta');
  if (meta?.seededAt) return false;
  if (meta?.seedingAt && Date.now() - meta.seedingAt < 15000) return false; // another tab is seeding
  store.set('demoMeta', { seedingAt: Date.now() });
  try {
    await seed();
  } catch (err) {
    // Start clean next time instead of keeping half-seeded data.
    store.reset();
    throw err;
  }
  store.set('demoMeta', { seededAt: Date.now() });
  return true;
}

// Shifts every timestamp ("at", "...At") in a record back by `ms`.
function shiftTimes(o, ms) {
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' && v > 1e12 && (k === 'at' || /At$/.test(k))) o[k] = v - ms;
    else if (v && typeof v === 'object') shiftTimes(v, ms);
  }
}

async function seed() {
  const today = todayIST();
  const ahead = [1, 2, 3, 4, 5, 6].map((n) => addDays(today, n));
  const isWeekend = (d) => [0, 6].includes(dayOfWeek(d));
  const weekendDays = ahead.filter(isWeekend);
  const weekend = weekendDays[0];
  // Holiday: the second weekend day if there is one, otherwise the last weekday —
  // this always leaves four weekdays (W1–W4) and one weekend day for the examples.
  const holiday = weekendDays[1] || [...ahead].reverse().find((d) => !isWeekend(d));
  const [W1, W2, W3, W4] = ahead.filter((d) => !isWeekend(d) && d !== holiday);

  // ---- Admins & settings (MAIN_ADMIN_EMAILS bootstrap → Main Admin, defaults seeded) ----
  await call('syncAccount', {}, 'demo-main');
  await call('setAdminRole', { email: 'prakash.choudhary@nift.ac.in', role: 'staff' }, 'demo-main');
  await call('setAdminRole', { email: 'meera.iyer@nift.ac.in', role: 'fccc' }, 'demo-main');
  for (const uid of ['demo-staff', 'demo-fccc']) await call('syncAccount', {}, uid);
  // FC-CC's saved approval signature (stamped onto everything she approves).
  await call('saveMySignature', { signature: signature('Meera Iyer') }, 'demo-fccc');

  // ---- Students register exactly as they would on first login ----
  const students = ['demo-fc', 'demo-fc2', 'demo-fc3', 'demo-other', 'demo-fd', 'demo-ad', 'demo-mfm', 'demo-idm', 'demo-first', 'demo-td', 'demo-grad'];
  for (const uid of students) {
    const a = accountByUid(uid);
    await call('syncAccount', {}, uid);
    await call('registerStudent', { name: a.name, ...a.profile }, uid);
  }

  // Staff Admin classifications.
  await call('updateStudent', { niftId: 'FC/23/030', studentType: 'FC_IDM_STUDENT', remarks: 'IDM elective' }, 'demo-staff');
  await call('updateStudent', { niftId: 'FC/22/011', status: 'GRADUATED', remarks: 'Batch 2022 passed out' }, 'demo-staff');

  // Calendar overrides & holiday.
  await call('setSlotOverride', { date: W2, hours: [15, 16], type: 'open', reason: 'CLS room free — department shoot approved' }, 'demo-staff');
  await call('setSlotOverride', { date: W1, hours: [22], type: 'block', reason: 'Lighting rig maintenance' }, 'demo-staff');
  await call('setHoliday', { date: holiday, name: 'Institute Holiday (demo)', open: false }, 'demo-staff');

  // ---- Helpers ----
  const guide = [];
  const note = (group, title, text, bookingId, signInAs) => guide.push({ group, title, text, bookingId: bookingId || null, signInAs: signInAs || null });
  const create = (uid, name, date, startHour, endHour, purpose, equipment, extra) =>
    call('createBooking', booking(name, date, startHour, endHour, purpose, equipment, extra), uid);
  const fcccApprove = (r) => call('adminBookingDecision', { bookingId: r.bookingId, decision: 'approve', remarks: 'Approved' }, 'demo-fccc');
  const fcccReject = (r, remarks) => call('adminBookingDecision', { bookingId: r.bookingId, decision: 'reject', remarks }, 'demo-fccc');
  const fcAnswer = (r, uid, decision = 'approve', reason) =>
    call('respondFcApproval', { approvalId: store.getRaw(`bookings/${r.bookingId}/fcApprovalId`), decision, reason }, uid);
  const printForm = (r) =>
    call('specialApprovalStep', { bookingId: r.bookingId, step: 'fcAssistant', decision: 'approve', remarks: 'Form printed and handed to the student' }, 'demo-staff');
  const finalApprove = (r) =>
    call('specialApprovalStep', { bookingId: r.bookingId, step: 'final', decision: 'approve', remarks: 'Director signed the paper form — approved' }, 'demo-fccc');
  const finalReject = (r, remarks) => call('specialApprovalStep', { bookingId: r.bookingId, step: 'final', decision: 'reject', remarks }, 'demo-fccc');

  // =========== NORMAL BOOKINGS (weekday 5–10 PM) ===========
  const n1 = await create('demo-fc', 'Aarav Mehta', W1, 17, 21, 'Portfolio shoot — product still life', ['photoLab', 'camera', 'lights', 'rgbLight'], { project: 'Fashion Photography' });
  await fcccApprove(n1);
  note('Normal bookings', 'FC student · 4 hours · APPROVED',
    'FC students can book up to 4 hours (others 3). The FC-CC approved it and her digital signature is on the booking. No printing needed.', n1.bookingId, 'demo-fc');

  const n2 = await create('demo-fc2', 'Neha Verma', W1, 21, 22, 'Editorial fashion shoot for Styling assignment', ['photoLab', 'lights', 'trigger'], { ...FACULTY2, project: 'Styling', team: 4 });
  note('Normal bookings', 'Waiting for FC-CC approval',
    'Every booking waits for the FC-CC. Sign in as the FC-CC → Approvals → "Sign & approve" or "Reject".', n2.bookingId, 'demo-fccc');

  const n3 = await create('demo-fc3', 'Meghna Das', W4, 21, 22, 'Macro jewellery shoot', ['photoLab', 'lights'], { project: 'Accessory photography' });
  await fcccApprove(n3);
  const n4 = await create('demo-fc3', 'Meghna Das', W2, 19, 20, 'Test shoot', ['photoLab'], { project: 'Practice' });
  await call('cancelBooking', { bookingId: n4.bookingId, reason: 'Model unavailable' }, 'demo-fc3');
  note('Cancellations', 'Student cancelled → blocked for 4 days',
    'Meghna cancelled her own booking, so she cannot book for 4 days. Sign in as Meghna to see the red message. Her other approved booking is not affected. Staff can lift the block (Students → View → "Allow booking now").', n4.bookingId, 'demo-fc3');

  const n5 = await create('demo-staff', 'Ishaan Kapoor', W2, 19, 20, 'Booked at the FC office — slot freed by a cancellation', ['photoLab', 'lights'], { onBehalfOfNiftId: 'FC/23/030', project: 'IDM' });
  note('Staff bookings', 'FC Lab Assistant booked for a student → waits for FC-CC',
    'Staff can book for a student (here into the slot Meghna just cancelled). It still needs FC-CC approval.', n5.bookingId, 'demo-staff');

  const n6 = await create('demo-staff', 'Neha Verma', W2, 20, 21, 'Studio orientation — new lighting kit', ['photoLab', 'lights', 'rgbLight'], { onBehalfOfNiftId: 'FC/24/022', remarks: 'Booked at the FC office counter' });
  await fcccApprove(n6);
  note('Staff bookings', 'Staff booking → APPROVED by FC-CC', 'A booking made by staff on behalf of Neha, approved and signed by the FC-CC.', n6.bookingId, 'demo-fc2');

  // =========== OTHER DEPARTMENTS (FC student approves first; no FC camera) ===========
  const o1 = await create('demo-other', 'Riya Sharma', W2, 17, 19, 'Portfolio Shoot', ['photoLab', 'lights'], { fcStudentNiftId: 'FC/23/014', project: 'BFT portfolio' });
  note('Other departments', 'Waiting for the FC student (Aarav) to approve',
    'Other-department students must name an FC student. Sign in as Aarav → Home shows the request with Approve / Reject. In the booking form, other departments get no Camera option and see the red "bring your own camera" note.', o1.bookingId, 'demo-fc');

  const o2 = await create('demo-mfm', 'Arjun Mehra', W2, 15, 17, 'Product shoot for MFM brand project', ['photoLab', 'lights', 'trigger'], { fcStudentNiftId: 'FC/24/022', project: 'Brand launch' });
  await fcAnswer(o2, 'demo-fc2');
  note('Other departments', 'FC student approved → waiting for FC-CC (CLS slot opened by staff)',
    '3–5 PM is normally CLS class time, but staff opened it on this day. Neha (FC) approved; the FC-CC must still approve.', o2.bookingId, 'demo-fccc');

  const o3 = await create('demo-ad', 'Rohan Gupta', W2, 21, 22, 'Accessory catalogue shoot', ['photoLab', 'lights'], { fcStudentNiftId: 'FC/24/022', project: 'AD catalogue' });
  await fcAnswer(o3, 'demo-fc2', 'reject', 'I am not part of this shoot.');
  note('Other departments', 'FC student REJECTED', 'Neha said she is not part of the shoot, so the booking was rejected and the slot freed.', o3.bookingId, 'demo-ad');

  const o4 = await create('demo-other', 'Riya Sharma', W3, 18, 20, 'Green-screen test for fashion film', ['photoLab', 'greenRoom'], { ...FACULTY2, fcStudentNiftId: 'FC/24/022', project: 'Fashion film' });
  await fcAnswer(o4, 'demo-fc2');
  await fcccApprove(o4);
  note('Other departments', 'FC student approved → FC-CC APPROVED', 'The full other-department path, finished.', o4.bookingId, 'demo-other');

  const o5 = await create('demo-ad', 'Rohan Gupta', W4, 19, 21, 'Ad film storyboard shoot', ['photoLab', 'lights', 'rgbLight'], { fcStudentNiftId: 'FC/23/014', project: 'AD film' });
  await fcAnswer(o5, 'demo-fc');
  await fcccReject(o5, 'Lab reserved for jury preparation that evening. Please choose another day.');
  note('Other departments', 'FC student approved → FC-CC REJECTED', 'Even after the FC student approves, the FC-CC has the final word. The reason is shown to the student.', o5.bookingId, 'demo-ad');

  // =========== FIRST-YEAR (must book with a senior) ===========
  const f1 = await create('demo-first', 'Kabir Singh', W3, 17, 18, 'First studio practice with senior', ['photoLab', 'lights'], { seniorNiftId: 'FC/23/014', project: 'Basic Photography' });
  note('First-year students', 'First-year FC student with a senior', 'Semester 1–2 students cannot book alone; Kabir added Aarav (Sem 6) as his senior. Waiting for FC-CC.', f1.bookingId, 'demo-first');

  const f2 = await create('demo-td', 'Priya Nair', W4, 17, 19, 'Textile swatch photography', ['photoLab', 'lights'], { seniorNiftId: 'FD/23/055', fcStudentNiftId: 'FC/23/014', project: 'Surface design' });
  note('First-year students', 'First-year other-department student', 'Priya (TD, Sem 1) added a senior (Sneha) AND an FC student (Aarav). Waiting for Aarav first.', f2.bookingId, 'demo-td');

  // =========== FACULTY ===========
  const fa = await create('demo-idm', 'Ishaan Kapoor', W3, 20, 22, 'Video interview setup for IDM project', ['photoLab', 'camera', 'lights'], { project: 'IDM' });
  await fcccApprove(fa);
  const outbox = Object.values(store.getRaw('demoOutbox') || {});
  const facultyMail = outbox.find((m) => m.subject.includes(fa.bookingId) && m.subject.includes('Information'));
  const token = /[?&]t=([A-Za-z0-9_-]+)/.exec(facultyMail?.text || '')?.[1];
  if (token) await call('facultyRespond', { bookingId: fa.bookingId, token, remarks: 'I have not been informed about this shoot.' }, 'demo-faculty');
  note('Faculty', 'Faculty clicked "I DID NOT APPROVE THIS"',
    'Every booking emails the faculty for information. Dr. Anjali Rao said she did not approve it, so it is on hold until the FC-CC decides.', fa.bookingId, 'demo-fccc');

  // =========== FC-CC cancels an approved booking ===========
  const c1 = await create('demo-fc2', 'Neha Verma', W4, 19, 20, 'Lighting test', ['photoLab', 'lights'], { project: 'Lighting' });
  await fcccApprove(c1);
  await call('cancelBooking', { bookingId: c1.bookingId, reason: 'Lab needed for an official department shoot.' }, 'demo-fccc');
  note('Cancellations', 'Cancelled by the FC-CC', "Only the FC-CC can cancel someone else's booking. The student is not blocked in this case.", c1.bookingId, 'demo-fc2');

  // =========== SPECIAL (after 10 PM · weekend · holiday) ===========
  const s1 = await create('demo-fc2', 'Neha Verma', W1, 23, 24, 'Night sky product shoot', ['photoLab', 'lights', 'trigger'], { project: 'Night photography' });
  note('Special approval', 'After 10 PM → FC Lab Assistant must print the form',
    'Step 1: the FC Lab Assistant prints the form and hands it to the student (Approvals → "Special: print & issue form").', s1.bookingId, 'demo-staff');

  const s2 = await create('demo-fc', 'Aarav Mehta', weekend, 11, 14, 'Lookbook shoot with external models', ['photoLab', 'camera', 'lights', 'clsRoom'], {
    equipmentReasons: { clsRoom: 'Needed as a styling and changing room for the models' }, project: 'Graduation lookbook', team: 6,
  });
  await printForm(s2);
  note('Special approval', 'Weekend · FC student · form is with the student',
    "Form printed. The student takes it to the Director's PA → Director signs → FC-CC approves & signs in the portal.", s2.bookingId, 'demo-fc');

  const s3 = await create('demo-fc2', 'Neha Verma', weekend, 9, 11, 'Morning natural-light portraits', ['photoLab', 'lights'], { project: 'Portraiture' });
  await printForm(s3);
  await finalApprove(s3);
  note('Special approval', 'Weekend · FULLY APPROVED → give form to Admin Guard',
    'Director signed on paper, FC-CC approved and signed digitally. Open "Print form" to see all signatures and the bold Admin Guard line.', s3.bookingId, 'demo-fc2');

  const s4 = await create('demo-other', 'Riya Sharma', weekend, 15, 17, 'Weekend product shoot for BFT project', ['photoLab', 'lights'], { fcStudentNiftId: 'FC/23/014', project: 'BFT product' });
  await fcAnswer(s4, 'demo-fc');
  note('Special approval', 'Weekend · other department · FC student approved → form to print',
    "Other-department route: FC Lab Assistant prints → Dept CC / subject faculty signs → Director's PA → Director → FC-CC.", s4.bookingId, 'demo-staff');

  const s5 = await create('demo-fd', 'Sneha Joshi', W3, 22, 24, 'Late-night garment shoot for FD jury', ['photoLab', 'lights', 'rgbLight'], { fcStudentNiftId: 'FC/23/031', project: 'FD jury' });
  await fcAnswer(s5, 'demo-fc3');
  await printForm(s5);
  note('Special approval', 'After 10 PM · FD student · form issued (needs FD CC signature)',
    "Sneha has the paper form: FD CC / subject faculty → Director's PA → Director → FC-CC.", s5.bookingId, 'demo-fd');

  const s6 = await create('demo-mfm', 'Arjun Mehra', weekend, 17, 20, 'Weekend campaign shoot', ['photoLab', 'lights', 'greenRoom'], { fcStudentNiftId: 'FC/24/022', project: 'Campaign' });
  await fcAnswer(s6, 'demo-fc2');
  await printForm(s6);
  await finalReject(s6, 'Department CC signature missing on the paper form.');
  note('Special approval', 'Special · REJECTED by FC-CC', 'The paper form came back without the department CC signature, so the FC-CC rejected it.', s6.bookingId, 'demo-mfm');

  const s7 = await create('demo-fd', 'Sneha Joshi', weekend, 20, 22, 'Evening styling shoot', ['photoLab', 'lights'], { fcStudentNiftId: 'FC/24/022', project: 'Styling' });
  note('Special approval', 'Special · waiting for the FC student first', "Other-department specials still start with the FC student's approval (Neha).", s7.bookingId, 'demo-fc2');

  const s8 = await create('demo-fc', 'Aarav Mehta', W4, 22, 24, 'Long-exposure light painting', ['photoLab', 'camera', 'rgbLight'], { project: 'Experimental' });
  await printForm(s8);
  await finalApprove(s8);
  note('Special approval', 'After 10 PM · FC student · APPROVED', 'Signatures on the form: Student (digital), Director (paper), FC-CC (digital).', s8.bookingId, 'demo-fc');

  // =========== PAST (completed / expired) ===========
  // Made through the real flow on a free future slot, then moved into the past.
  let pastSeq = 0;
  const toPast = (r, daysAgo, startHour, endHour, status) => {
    const old = store.getRaw(`bookings/${r.bookingId}`);
    const date = addDays(today, -daysAgo);
    const b = structuredClone(old);
    shiftTimes(b, diffDays(date, old.date) * 86400000);
    const id = bookingIdFor(addDays(date, -2), 9000 + ++pastSeq);
    Object.assign(b, {
      id, date, startHour, endHour, status,
      duration: endHour - startHour,
      startAt: slotStartMs(date, startHour),
      endAt: slotStartMs(date, endHour),
      updatedAt: slotStartMs(date, endHour),
    });
    b.history = b.history || {};
    if (status === STATUS.COMPLETED) {
      b.history[`zz${pastSeq}`] = { at: b.endAt + 60000, status, event: 'COMPLETED', by: 'System', uid: 'system', role: 'system', note: null };
    } else {
      const reason = 'Not approved before the booking time — expired automatically.';
      b.rejection = { byUid: 'system', byName: 'System', role: 'system', at: b.startAt, reason, expired: true };
      b.history[`zz${pastSeq}`] = { at: b.startAt, status, event: 'EXPIRED — NOT APPROVED IN TIME', by: 'System', uid: 'system', role: 'system', note: reason };
    }
    for (const [k, v] of Object.entries(store.getRaw(`bookingSlots/${old.date}`) || {})) {
      if (v?.bookingId === old.id) store.set(`bookingSlots/${old.date}/${k}`, null);
    }
    if (SLOT_HOLDING_STATUSES.includes(status)) {
      for (let h = startHour; h < endHour; h++) store.set(`bookingSlots/${date}/${slotKey(h)}`, { bookingId: id, status, uid: b.studentUid });
    }
    if (b.fcApprovalId) store.set(`fcApprovals/${b.fcApprovalId}/bookingId`, id);
    store.set(`bookings/${old.id}`, null);
    store.set(`bookings/${id}`, b);
    return id;
  };
  // W4 7–9 PM is free again (cancelled / rejected above) — reused for each.
  let p = await create('demo-fc', 'Aarav Mehta', W4, 19, 21, 'Jewellery catalogue shoot', ['photoLab', 'camera', 'lights'], { project: 'Catalogue' });
  await fcccApprove(p);
  note('Past bookings', 'COMPLETED (2 days ago)', 'Approved bookings become Completed automatically after the end time. History is kept forever.', toPast(p, 2, 17, 21, STATUS.COMPLETED), 'demo-fc');

  p = await create('demo-other', 'Riya Sharma', W4, 19, 21, 'Fabric drape study', ['photoLab', 'lights'], { fcStudentNiftId: 'FC/24/022', project: 'Draping' });
  await fcAnswer(p, 'demo-fc2');
  await fcccApprove(p);
  note('Past bookings', 'Other department · COMPLETED (5 days ago)', 'A finished other-department booking with FC student and FC-CC approval.', toPast(p, 5, 18, 20, STATUS.COMPLETED), 'demo-other');

  p = await create('demo-fc2', 'Neha Verma', W4, 19, 20, 'Headshots for class profile', ['photoLab', 'lights'], { project: 'Headshots' });
  await fcccApprove(p);
  note('Past bookings', 'COMPLETED (yesterday)', "Yesterday's booking, now completed.", toPast(p, 1, 18, 19, STATUS.COMPLETED), 'demo-fc2');

  p = await create('demo-idm', 'Ishaan Kapoor', W4, 19, 21, 'Stop-motion test', ['photoLab', 'lights'], { project: 'IDM animation' });
  note('Past bookings', 'EXPIRED — never approved in time', 'If the FC-CC does not approve before the start time, the booking expires automatically.', toPast(p, 3, 19, 21, STATUS.REJECTED), 'demo-idm');

  // =========== Calendar rules & accounts (no booking) ===========
  note('Calendar rules', 'CLS class hours 9 AM–5 PM on weekdays', `Grey "CLS CLASS" blocks cannot be booked unless staff open them (see the opened 3–5 PM slot on ${W2}).`, null, 'demo-fc');
  note('Calendar rules', 'Blocked slot (maintenance)', `Staff blocked 10–11 PM on ${W1} for lighting rig maintenance.`, null, 'demo-staff');
  note('Calendar rules', 'Institute holiday', `${holiday} is a closed holiday — nobody can book it unless staff open it.`, null, 'demo-fc');
  note('Accounts', 'Graduated student cannot book', 'Tanya Rathore has graduated; she can sign in and see her history but cannot book.', null, 'demo-grad');
  note('Accounts', 'New student → registration', 'Sign in as "New Student" to see the first-login registration form.', null, 'demo-new');

  guide.forEach((g, i) => store.set(`demoGuide/g${String(i + 1).padStart(2, '0')}`, { ...g, order: i + 1 }));
}
