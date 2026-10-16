// Seeds the demo with realistic data by calling the REAL backend functions as
// each demo user — so every record goes through production validation.
import { demoCall } from './server.js';
import { store } from './store.js';
import { accountByUid } from './session.js';
import { todayIST, addDays, dayOfWeek } from '@shared/calendar.js';

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

async function seed() {
  const today = todayIST();
  const ahead = [1, 2, 3, 4, 5, 6].map((n) => addDays(today, n));
  const weekdays = ahead.filter((d) => ![0, 6].includes(dayOfWeek(d)));
  const weekend = ahead.find((d) => [0, 6].includes(dayOfWeek(d)));
  const [W1, W2, W3, W4] = weekdays;

  // Admins & settings (MAIN_ADMIN_EMAILS bootstrap → Main Admin, defaults seeded).
  await call('syncAccount', {}, 'demo-main');
  await call('setAdminRole', { email: 'prakash.choudhary@nift.ac.in', role: 'staff' }, 'demo-main');
  await call('setAdminRole', { email: 'meera.iyer@nift.ac.in', role: 'fccc' }, 'demo-main');
  for (const uid of ['demo-staff', 'demo-fccc']) await call('syncAccount', {}, uid);
  // FC-CC's saved approval signature (stamped onto special forms she approves).
  await call('saveMySignature', { signature: signature('Meera Iyer') }, 'demo-fccc');

  // Students register exactly as they would on first login.
  for (const uid of ['demo-fc', 'demo-fc2', 'demo-other', 'demo-idm', 'demo-first', 'demo-grad']) {
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
  if (W4) await call('setHoliday', { date: W4, name: 'Institute Holiday (demo)', open: false }, 'demo-staff');

  // Bookings across every status. Nothing is confirmed until the FC-CC approves.
  const fcccApprove = (r) => call('adminBookingDecision', { bookingId: r.bookingId, decision: 'approve' }, 'demo-fccc');
  const fcApprove = (r, uid) => call('respondFcApproval', { approvalId: store.getRaw(`bookings/${r.bookingId}/fcApprovalId`), decision: 'approve' }, uid);

  // FC student: 4-hour booking, approved & signed by the FC-CC.
  await fcccApprove(await call('createBooking', booking('Aarav Mehta', W1, 17, 21, 'Portfolio shoot — product still life', ['photoLab', 'camera', 'lights'], { project: 'Fashion Photography' }), 'demo-fc'));
  // FC student booking — waiting for the FC-CC.
  await call('createBooking', booking('Neha Verma', W1, 21, 22, 'Editorial fashion shoot for Styling assignment', ['photoLab', 'lights', 'trigger'], { ...FACULTY2, project: 'Styling', team: 4 }), 'demo-fc2');
  // Staff booking on behalf of a student.
  await fcccApprove(await call('createBooking', booking('Neha Verma', W2, 20, 21, 'Studio orientation — new lighting kit', ['photoLab', 'lights'], { onBehalfOfNiftId: 'FC/24/022', remarks: 'Booked at the FC office counter' }), 'demo-staff'));

  // Other department: one waiting for FC student approval, one approved by the FC student.
  await call('createBooking', booking('Riya Sharma', W2, 17, 19, 'Portfolio Shoot', ['photoLab', 'camera', 'lights'], { fcStudentNiftId: 'FC/23/014', bringOwnAck: true, project: 'BFT portfolio' }), 'demo-other');
  const b5 = await call('createBooking', booking('Riya Sharma', W3, 18, 20, 'Green-screen test for fashion film', ['photoLab', 'greenRoom'], { ...FACULTY2, fcStudentNiftId: 'FC/24/022', project: 'Fashion film' }), 'demo-other');
  await fcApprove(b5, 'demo-fc2');
  await fcccApprove(b5);

  // Special (weekend / after 10 PM): FC route and other-department route.
  if (weekend) {
    const b6 = await call('createBooking', booking('Aarav Mehta', weekend, 11, 14, 'Lookbook shoot with external models', ['photoLab', 'camera', 'lights', 'clsRoom'], {
      equipmentReasons: { clsRoom: 'Needed as a styling and changing room for the models' }, project: 'Graduation lookbook', team: 6,
    }), 'demo-fc');
    await call('specialApprovalStep', { bookingId: b6.bookingId, step: 'fcAssistant', decision: 'approve', remarks: 'Form printed and handed to student' }, 'demo-staff');
    const r7 = await call('createBooking', booking('Riya Sharma', weekend, 15, 17, 'Weekend product shoot for BFT project', ['photoLab', 'lights'], { fcStudentNiftId: 'FC/23/014', project: 'BFT product' }), 'demo-other');
    await fcApprove(r7, 'demo-fc');
  }
  await call('createBooking', booking('Neha Verma', W2, 21, 23, 'Night portrait lighting study', ['photoLab', 'lights', 'trigger']), 'demo-fc2');

  const b8 = await call('createBooking', booking('Ishaan Kapoor', W3, 20, 22, 'Video interview setup for IDM project', ['photoLab', 'camera', 'lights'], { project: 'IDM' }), 'demo-idm');
  await fcccApprove(b8);
  const outbox = Object.values(store.getRaw('demoOutbox') || {});
  const facultyMail = outbox.find((m) => m.subject.includes(b8.bookingId) && m.subject.includes('Information'));
  const token = /[?&]t=([A-Za-z0-9_-]+)/.exec(facultyMail?.text || '')?.[1];
  if (token) {
    await call('facultyRespond', { bookingId: b8.bookingId, token, remarks: 'I have not been informed about this shoot.' }, 'demo-faculty');
  }

  await call('createBooking', booking('Kabir Singh', W3, 17, 18, 'First studio practice with senior', ['photoLab', 'lights'], { seniorNiftId: 'FC/23/014', project: 'Basic Photography' }), 'demo-first');

  const b10 = await call('createBooking', booking('Aarav Mehta', W2, 19, 20, 'Test shoot', ['photoLab']), 'demo-fc');
  await call('cancelBooking', { bookingId: b10.bookingId, reason: 'Model unavailable' }, 'demo-fc');
}
