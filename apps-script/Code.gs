/**
 * FC Photography Lab — NIFT Jodhpur
 * Email + booking register in Google Sheets.
 *
 * The booking system (Firebase Cloud Functions) POSTs here every time it needs
 * to send an email. This script:
 *   1. sends the email from the Gmail account that owns this script, and
 *   2. keeps ONE live row per booking in the "Bookings" tab (status, student,
 *      faculty …). When the faculty presses "I DID NOT APPROVE THIS",
 *      that booking's row turns RED.
 *   3. logs every email in the "Emails" tab.
 *
 * Setup (once): see apps-script/README.md. In short:
 *   Run `setup` → copy the SECRET from the log → Deploy as Web app → copy URL.
 */

const BOOKINGS = 'Bookings';
const EMAILS = 'Emails';

const BOOKING_HEADERS = [
  'Booking ID', 'Status', 'Student', 'NIFT ID', 'Student email', 'Dept', 'Sem', 'Student type',
  'Date', 'Time', 'Hours', 'Purpose', 'Equipment', 'Special (after 10 PM / weekend / holiday)',
  'Faculty', 'Faculty email', 'Faculty response', 'FC student involved', 'Approved by (FC-CC)',
  'Open in app', 'Created', 'Last update',
];
const EMAIL_HEADERS = ['Time', 'To', 'Subject', 'Type', 'Booking ID', 'Result'];
const COL = Object.fromEntries(BOOKING_HEADERS.map((h, i) => [h, i + 1]));

const COLORS = {
  red: '#f4c7c3', redText: '#a50e0e',
  green: '#d9ead3', yellow: '#fff2cc', orange: '#fce5cd', blue: '#cfe2f3', grey: '#efefef', greyText: '#777777',
};

// ---------------------------------------------------------------------------
// Web app endpoint
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('SECRET');
    if (!secret || body.secret !== secret) return json({ ok: false, error: 'Unauthorized' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (body.booking) upsertBooking(body.booking);
      if (body.action === 'mail' && body.mail) {
        const result = sendMail(body.mail, props);
        logEmail(body.mail, body.booking, result);
      }
    } finally {
      lock.releaseLock();
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return ContentService.createTextOutput('FC Photography Lab mail endpoint is running.');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
function sendMail(mail, props) {
  let to = [].concat(mail.to || []).filter(Boolean).join(',');
  if (!to) return 'skipped — no recipient';
  let subject = mail.subject || 'FC Photography Lab';

  // TEST MODE (default after setup): every email goes to you instead of the
  // real student / faculty. Turn off with goLive() when you are ready.
  if (props.getProperty('TEST_MODE') !== 'false') {
    const testTo = props.getProperty('TEST_EMAIL') || Session.getEffectiveUser().getEmail();
    subject = '[TEST → ' + to + '] ' + subject;
    to = testTo;
  }
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Daily Gmail sending limit reached');

  const options = { htmlBody: mail.html, name: props.getProperty('SENDER_NAME') || 'FC Photography Lab — NIFT Jodhpur' };
  const replyTo = props.getProperty('REPLY_TO');
  if (replyTo) options.replyTo = replyTo;
  MailApp.sendEmail(to, subject, mail.text || '', options);
  return props.getProperty('TEST_MODE') !== 'false' ? 'sent (TEST → ' + to + ')' : 'sent';
}

function logEmail(mail, booking, result) {
  const sh = sheet(EMAILS, EMAIL_HEADERS);
  sh.appendRow([new Date(), [].concat(mail.to || []).join(', '), mail.subject || '', mail.type || '', booking ? booking.id : '', result]);
}

// ---------------------------------------------------------------------------
// Bookings register — one row per booking, updated on every change
// ---------------------------------------------------------------------------
function upsertBooking(b) {
  const sh = sheet(BOOKINGS, BOOKING_HEADERS);
  const facultyResponse = b.facultySaidNo
    ? 'DID NOT APPROVE' + (b.facultyRemarks ? ' — ' + b.facultyRemarks : '') + (b.facultyConcernOpen ? '' : ' (FC-CC decided)')
    : (b.facultyEmail ? 'No objection' : '');
  const row = [
    b.id, b.statusLabel, b.student, b.niftId, b.email, b.department, b.semester, b.studentType,
    b.date, b.time, b.hours, b.purpose, b.equipment, b.special,
    b.facultyName, b.facultyEmail, facultyResponse, b.fcStudent, b.approvedBy,
    b.link, b.createdAt ? new Date(b.createdAt) : '', new Date(),
  ];

  const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map((r) => String(r[0])) : [];
  const idx = ids.indexOf(String(b.id));
  const r = idx >= 0 ? idx + 2 : sh.getLastRow() + 1;
  if (idx >= 0) row[COL['Created'] - 1] = sh.getRange(r, COL['Created']).getValue() || row[COL['Created'] - 1];
  const range = sh.getRange(r, 1, 1, row.length);
  range.setValues([row]);
  colorRow(sh, r, b);
}

function colorRow(sh, r, b) {
  const all = sh.getRange(r, 1, 1, BOOKING_HEADERS.length);
  all.setBackground(null).setFontColor(null).setFontWeight('normal');

  // Faculty said "I DID NOT APPROVE THIS" and the FC-CC has not decided yet → whole row red.
  if (b.facultyConcernOpen) {
    all.setBackground(COLORS.red).setFontColor(COLORS.redText).setFontWeight('bold');
    return;
  }
  const status = sh.getRange(r, COL['Status']);
  switch (b.status) {
    case 'APPROVED': status.setBackground(COLORS.green); break;
    case 'COMPLETED': status.setBackground(COLORS.blue); break;
    case 'REJECTED':
    case 'CANCELLED_BY_STUDENT':
    case 'CANCELLED_BY_ADMIN':
      all.setFontColor(COLORS.greyText); status.setBackground(COLORS.grey); break;
    case 'PENDING_SPECIAL_APPROVAL': status.setBackground(COLORS.orange); break;
    default: status.setBackground(COLORS.yellow);
  }
  // Faculty objected earlier (already decided by FC-CC) → keep that cell red.
  if (b.facultySaidNo) sh.getRange(r, COL['Faculty response']).setBackground(COLORS.red).setFontColor(COLORS.redText).setFontWeight('bold');
}

function sheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1d1d1f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------------------------------------------------------------------------
// One-time setup & helpers (run from the Apps Script editor)
// ---------------------------------------------------------------------------

/** Creates the tabs, a secret key and turns on TEST MODE. Copy the SECRET from the log. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('TEST_MODE')) props.setProperty('TEST_MODE', 'true');
  sheet(BOOKINGS, BOOKING_HEADERS);
  sheet(EMAILS, EMAIL_HEADERS);
  const first = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 2) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(first);
  Logger.log('SECRET (put this in functions/.env as SHEETS_WEBHOOK_SECRET): ' + props.getProperty('SECRET'));
  Logger.log('TEST_MODE is ' + props.getProperty('TEST_MODE') + ' — all emails go to ' + (props.getProperty('TEST_EMAIL') || Session.getEffectiveUser().getEmail()));
}

/** Sends you a sample email and adds two sample rows (one red: faculty said no). */
function sendTest() {
  const props = PropertiesService.getScriptProperties();
  const sample = {
    id: 'FC-TEST-0001', status: 'PENDING_FCCC_APPROVAL', statusLabel: 'Pending FC-CC Approval', student: 'Test Student',
    email: Session.getEffectiveUser().getEmail(), niftId: 'FC/23/000', department: 'FC', semester: 6, studentType: 'FC Student',
    date: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'), time: '5:00 PM – 7:00 PM', hours: 2,
    purpose: 'Test booking', equipment: 'Photography Lab, Lights', special: '', facultyName: 'Test Faculty',
    facultyEmail: Session.getEffectiveUser().getEmail(), fcStudent: '', approvedBy: '', link: '', createdAt: Date.now(),
    facultySaidNo: false, facultyConcernOpen: false,
  };
  upsertBooking(sample);
  upsertBooking(Object.assign({}, sample, {
    id: 'FC-TEST-0002', status: 'FACULTY_CONCERN', statusLabel: 'Faculty Concern', facultySaidNo: true, facultyConcernOpen: true,
    facultyRemarks: 'I have not been informed about this shoot.',
  }));
  const mail = {
    type: 'test', to: [Session.getEffectiveUser().getEmail()], subject: 'FC Photography Lab — test email',
    text: 'If you can read this, the Google Sheet email system works.',
    html: '<p>If you can read this, the <b>Google Sheet email system</b> works.</p>',
  };
  logEmail(mail, sample, sendMail(mail, props));
}

/** Real emails to students & faculty from now on. */
function goLive() {
  PropertiesService.getScriptProperties().setProperty('TEST_MODE', 'false');
  Logger.log('LIVE: emails now go to the real students and faculty.');
}

/** Back to test mode (all emails to you). */
function backToTestMode() {
  PropertiesService.getScriptProperties().setProperty('TEST_MODE', 'true');
}
