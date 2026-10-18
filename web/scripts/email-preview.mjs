// Renders every email the system sends (real templates from functions/src/notify.js)
// into one page: docs/email-preview.html. Run: node web/scripts/email-preview.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

process.env.VITE_APP_URL = 'https://fc-photography-lab.vercel.app';
process.env.VITE_SHEETS_WEBHOOK_URL = '';
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), mode: 'production',
  configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
  server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] },
});
await vite.ssrLoadModule('/src/demo/buffer-global.js');
const N = await vite.ssrLoadModule('/../functions/src/notify.js');
const { renderEmail } = await vite.ssrLoadModule('/../functions/src/mail.js');

const day = '2026-10-19';
const fcBooking = {
  id: 'FC-261018-0001', status: 'PENDING_FCCC_APPROVAL', studentName: 'Aarav Mehta', niftId: 'FC/23/014', email: 'aarav.mehta@nift.ac.in',
  department: 'FC', semester: 6, studentType: 'FC_STUDENT', date: day, startHour: 17, endHour: 21, duration: 4,
  purpose: 'Portfolio shoot — product still life', equipmentList: ['Photography Lab', 'Camera', 'Lights', 'RGB Light'],
  faculty: { name: 'Dr. Anjali Rao', email: 'anjali.rao@nift.ac.in' }, createdBy: { name: 'Aarav Mehta' },
};
const otherBooking = {
  ...fcBooking, id: 'FC-261018-0002', status: 'PENDING_FC_APPROVAL', studentName: 'Riya Sharma', niftId: 'BFT/23/041', email: 'riya.sharma@nift.ac.in',
  department: 'BFT', studentType: 'OTHER_DEPT_STUDENT', startHour: 18, endHour: 20, duration: 2, purpose: 'Green-screen test for fashion film',
  equipmentList: ['Photography Lab', 'Green Room'], bringsOwnCamera: true,
  fcStudent: { name: 'Neha Verma', niftId: 'FC/24/022', email: 'neha.verma@nift.ac.in' },
};
const specialBooking = {
  ...fcBooking, id: 'FC-261018-0003', status: 'PENDING_SPECIAL_APPROVAL', date: '2026-10-24', startHour: 11, endHour: 14, duration: 3,
  purpose: 'Lookbook shoot with external models', isSpecial: true, specialReasons: ['Weekend'],
};
const approved = (b) => ({ ...b, status: 'APPROVED', fcccApproval: { byName: 'Prof. Meera Iyer', at: Date.now() } });

const sections = [
  ['1. FC student books a normal slot', [
    ['Student', N.submittedEmail(fcBooking)],
    ['Faculty', N.facultyEmail(fcBooking, `${process.env.VITE_APP_URL}/faculty/${fcBooking.id}?t=EXAMPLE`)],
    ['FC-CC', N.fcccApprovalNeededEmail(fcBooking, ['meera.iyer@nift.ac.in'])],
    ['Student — confirmation', N.approvedEmail(approved(fcBooking))],
  ]],
  ['2. Other-department student (needs an FC student first)', [
    ['Student', N.submittedEmail(otherBooking)],
    ['FC student (Neha)', N.fcRequestEmail(otherBooking, 'APPROVAL-ID', otherBooking.fcStudent.email)],
    ['Student — FC student approved', N.fcApprovedEmail({ ...otherBooking, status: 'PENDING_FCCC_APPROVAL', fcApproval: { byName: 'Neha Verma', at: Date.now() } })],
    ['Student — FC student rejected', N.fcRejectedEmail({ ...otherBooking, status: 'REJECTED' }, 'I am not part of this shoot.')],
  ]],
  ['3. Special booking (after 10 PM / weekend / holiday)', [
    ['Student — what to do with the form', N.specialRequiredEmail(specialBooking, specialBooking.email, false)],
    ['FC Lab Assistant — form to print', N.specialRequiredEmail(specialBooking, ['prakash.choudhary@nift.ac.in'], true)],
    ['Student — form issued', N.formIssuedEmail({ ...specialBooking, special: { steps: { fcAssistant: { state: 'approved', byName: 'Prakash Choudhary', at: Date.now() } } } })],
    ['Student — approved (give form to Admin Guard)', N.approvedEmail(approved(specialBooking))],
  ]],
  ['4. Faculty says "I DID NOT APPROVE THIS"', [
    ['FC-CC / admins', N.facultyConcernAdminEmail({ ...fcBooking, status: 'FACULTY_CONCERN' }, ['meera.iyer@nift.ac.in'], 'I have not been informed about this shoot.')],
    ['Student', N.facultyConcernStudentEmail({ ...fcBooking, status: 'FACULTY_CONCERN' })],
    ['Student — FC-CC decided', N.concernResolvedEmail(approved(fcBooking), 'Booking kept (approved)', 'Checked with the faculty.')],
  ]],
  ['5. Other cases', [
    ['Student — rejected by FC-CC', N.rejectedEmail({ ...fcBooking, status: 'REJECTED' }, 'Lab reserved for jury preparation. Please choose another day.')],
    ['Student — cancelled own booking (4-day block)', N.cancelledEmail({ ...fcBooking, status: 'CANCELLED_BY_STUDENT' }, fcBooking.email, 'you', 'Model unavailable', Date.now() + 4 * 86400000)],
    ['Student — cancelled by FC-CC', N.cancelledEmail({ ...fcBooking, status: 'CANCELLED_BY_ADMIN' }, fcBooking.email, 'the FC-CC (Prof. Meera Iyer)', 'Lab needed for an official department shoot.')],
    ['Senior student (first-year booked with them)', N.seniorEmail({ ...fcBooking, studentName: 'Kabir Singh', niftId: 'FC/26/007', senior: { name: 'Aarav Mehta', niftId: 'FC/23/014', email: 'aarav.mehta@nift.ac.in' } })],
    ['Student — booked by FC staff', N.staffCreatedEmail({ ...fcBooking, bookedByStaff: true, createdBy: { name: 'Prakash Choudhary' } })],
  ]],
];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const thread = (b) => `FC Photography Lab – Booking ${b.id} · ${b.studentName}`;
let html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Preview</title>
<style>body{font-family:Arial,sans-serif;background:#eef0f3;margin:0;padding:24px;color:#111}h1{margin:0 0 6px}p.lead{margin:0 0 24px;color:#444;max-width:820px}
h2{margin:36px 0 12px;font-size:20px}.mail{background:#fff;border:1px solid #d6d9de;border-radius:10px;margin:0 0 18px;overflow:hidden;max-width:820px}
.meta{padding:10px 16px;background:#f7f8fa;border-bottom:1px solid #e3e5e8;font-size:13px}.meta b{display:inline-block;min-width:64px;color:#555}
.who{display:inline-block;background:#1a5fb4;color:#fff;border-radius:12px;padding:1px 10px;font-size:12px;margin-bottom:4px}
iframe{width:100%;border:0;height:520px;display:block}</style></head><body>
<h1>Emails sent by the FC Photography Lab system</h1>
<p class="lead">These are the real templates. All emails about one booking reach each person in <b>one Gmail conversation</b>: the first email starts it, and later steps come as replies. The red line at the top of each email says which step it is. In TEST mode everything goes to fc.jodhpur@nift.ac.in, with the real recipient in the subject.</p>`;
for (const [title, mails] of sections) {
  html += `<h2>${esc(title)}</h2>`;
  for (const [who, m] of mails) {
    const b = [fcBooking, otherBooking, specialBooking].find((x) => m.bookingId === x.id) || fcBooking;
    const banner = `<div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#b3261e;padding:10px 4px">${esc(m.subject)}</div>`;
    const body = banner + renderEmail(m.content);
    html += `<div class="mail"><div class="meta"><span class="who">${esc(who)}</span><br><b>To</b> ${esc([].concat(m.to).join(', '))}<br><b>Subject</b> ${esc(thread(b))}</div>
<iframe loading="lazy" srcdoc="${esc(body)}"></iframe></div>`;
  }
}
html += '</body></html>';
mkdirSync(new URL('../../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../docs/email-preview.html', import.meta.url), html);
console.log('docs/email-preview.html written');
await vite.close();
