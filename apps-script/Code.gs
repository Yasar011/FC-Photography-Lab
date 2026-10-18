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

// Public project settings (not secret) — used to check the sender's sign-in.
const FIREBASE_API_KEY = 'AIzaSyAx0F8ldw0SEecIJp6-4BLh1rWIGUrnbdg';
const DB_URL = 'https://fc-photography-lab-default-rtdb.firebaseio.com';
const ALLOWED_DOMAIN = '@nift.ac.in';
const APP_URL = 'https://fc-photography-lab.vercel.app';
const MAX_EMAILS_PER_USER_PER_HOUR = 60;

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

    let booking = body.booking || null;
    let sender = 'server';
    if (secret && body.secret === secret) {
      // Cloud Functions (trusted server): data as sent.
    } else if (body.idToken) {
      // The app on the free Spark plan: check who is signed in, read the booking
      // ourselves, and only email people connected to it.
      const user = verifyFirebaseUser(body.idToken);
      sender = user.email;
      rateLimit(user.email);
      const bookingId = (body.booking && body.booking.id) || null;
      const raw = bookingId ? readDb('bookings/' + bookingId, body.idToken) : null;
      if (bookingId && !raw) return json({ ok: false, error: 'Booking not found or not allowed' });
      booking = raw ? summarize(raw) : null;
      if (body.action === 'mail' && body.mail) checkRecipients(body.mail, raw, body.idToken);
    } else {
      return json({ ok: false, error: 'Unauthorized' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (booking) upsertBooking(booking);
      if (body.action === 'mail' && body.mail) {
        const result = sendMail(body.mail, props, booking);
        logEmail(body.mail, booking, result + (sender === 'server' ? '' : ' · by ' + sender));
      }
    } finally {
      lock.releaseLock();
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------------------
// Checks for requests coming from the browser (Spark plan)
// ---------------------------------------------------------------------------
function verifyFirebaseUser(idToken) {
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true,
  });
  const users = (JSON.parse(res.getContentText() || '{}').users) || [];
  const u = users[0];
  const email = u && String(u.email || '').toLowerCase();
  if (!u || u.emailVerified !== true || !email.endsWith(ALLOWED_DOMAIN)) throw new Error('Not a signed-in NIFT account');
  return { uid: u.localId, email: email };
}

function readDb(path, idToken) {
  const res = UrlFetchApp.fetch(DB_URL + '/' + path + '.json?auth=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  return JSON.parse(res.getContentText() || 'null');
}

function rateLimit(email) {
  const cache = CacheService.getScriptCache();
  const key = 'rate:' + email;
  const n = Number(cache.get(key) || 0) + 1;
  if (n > MAX_EMAILS_PER_USER_PER_HOUR) throw new Error('Too many emails from this account — try again later');
  cache.put(key, String(n), 3600);
}

/** Every recipient must be a NIFT address connected to the booking, or an admin. */
function checkRecipients(mail, b, idToken) {
  const ok = {};
  const add = (x) => { if (x) ok[String(x).toLowerCase()] = true; };
  if (b) {
    add(b.email);
    add(b.faculty && b.faculty.email);
    add(b.fcStudent && b.fcStudent.email);
    add(b.senior && b.senior.email);
  }
  const admins = readDb('admins', idToken) || {};
  Object.keys(admins).forEach((k) => add(admins[k] && admins[k].email));
  [].concat(mail.to || []).forEach((to) => {
    const t = String(to).toLowerCase();
    if (!t.endsWith(ALLOWED_DOMAIN) || !ok[t]) throw new Error('Recipient not allowed: ' + t);
  });
}

const STATUS_LABELS = {
  SUBMITTED: 'Booking Submitted', PENDING_FC_APPROVAL: 'Pending FC Student Approval', FC_APPROVED: 'FC Student Approved',
  PENDING_SPECIAL_APPROVAL: 'Pending Special Approval', PENDING_FCCC_APPROVAL: 'Pending FC-CC Approval',
  FACULTY_CONCERN: 'Faculty Concern', APPROVED: 'Approved', REJECTED: 'Rejected',
  CANCELLED_BY_STUDENT: 'Cancelled by Student', CANCELLED_BY_ADMIN: 'Cancelled by Admin', COMPLETED: 'Completed',
};
const TYPE_LABELS = { FC_STUDENT: 'FC Student', FC_IDM_STUDENT: 'FC-IDM Student', OTHER_DEPT_STUDENT: 'Other Department Student' };

function hourLabel(h) {
  const hh = ((h + 11) % 12) + 1;
  return hh + ':00 ' + (h % 24 < 12 ? 'AM' : 'PM');
}

/** Booking record from the database → one sheet row (same fields the server sends). */
function summarize(b) {
  const concern = b.facultyConcern || null;
  return {
    id: b.id, status: b.status, statusLabel: STATUS_LABELS[b.status] || b.status, student: b.studentName, email: b.email,
    niftId: b.niftId, department: b.department, semester: b.semester, studentType: TYPE_LABELS[b.studentType] || b.studentType,
    date: b.date, time: hourLabel(b.startHour) + ' – ' + hourLabel(b.endHour), hours: b.duration, purpose: b.purpose,
    equipment: (b.equipmentList || []).join(', '), special: b.isSpecial ? ((b.specialReasons || []).join(', ') || 'Yes') : '',
    facultyName: (b.faculty && b.faculty.name) || '', facultyEmail: (b.faculty && b.faculty.email) || '',
    fcStudent: b.fcStudent ? b.fcStudent.name + ' (' + b.fcStudent.niftId + ')' : '',
    facultySaidNo: Boolean(concern), facultyConcernOpen: Boolean(concern && !concern.resolved),
    facultyRemarks: (concern && concern.remarks) || '', approvedBy: (b.fcccApproval && b.fcccApproval.byName) || '',
    link: APP_URL + '/bookings/' + b.id, createdAt: b.createdAt || null,
  };
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
function sendMail(mail, props, booking) {
  const recipients = [].concat(mail.to || []).filter(Boolean);
  if (!recipients.length) return 'skipped — no recipient';
  if (MailApp.getRemainingDailyQuota() < recipients.length) throw new Error('Daily Gmail sending limit reached');

  // TEST MODE (default after setup): every email goes to you instead of the
  // real student / faculty. Turn off with goLive() when you are ready.
  const test = props.getProperty('TEST_MODE') !== 'false';
  const testTo = props.getProperty('TEST_EMAIL') || Session.getEffectiveUser().getEmail();
  const bookingId = booking && booking.id;
  // Live mode: fc.jodhpur (the sheet owner) also gets a hidden copy of every email.
  // Turn off with stopCopies(), back on with sendCopies().
  const owner = Session.getEffectiveUser().getEmail();
  const copy = !test && props.getProperty('COPY_ALL') !== 'false' ? (props.getProperty('COPY_TO') || owner) : '';
  const results = recipients.map(function (real) {
    const to = test ? testTo : real;
    const bcc = copy && copy.toLowerCase() !== String(to).toLowerCase() ? copy : '';
    const subject = (test ? '[TEST → ' + real + '] ' : '') + (bookingId ? threadSubject(booking) : (mail.subject || 'FC Photography Lab'));
    const html = updateBanner(mail.subject) + (mail.html || '');
    // One conversation per booking and person: later steps are replies to the first email.
    if (bookingId && gmailApiOn()) return sendThreaded((test ? 'T|' : '') + bookingId + '|' + real, to, subject, mail.text || '', html, props, bcc);
    const opts = mailOptions(html, props);
    if (bcc) opts.bcc = bcc;
    MailApp.sendEmail(to, subject, mail.text || '', opts);
    return 'sent';
  });
  return results.join(', ') + (test ? ' (TEST → ' + testTo + ')' : copy ? ' (copy to ' + copy + ')' : '');
}

function mailOptions(html, props) {
  const o = { htmlBody: html, name: props.getProperty('SENDER_NAME') || 'FC Photography Lab — NIFT Jodhpur' };
  const replyTo = props.getProperty('REPLY_TO');
  if (replyTo) o.replyTo = replyTo;
  return o;
}

/** Same subject for every email about one booking, so they stay in one conversation. */
function threadSubject(b) {
  let when = b.date || '';
  try {
    when = Utilities.formatDate(new Date(b.date + 'T12:00:00+05:30'), 'Asia/Kolkata', 'EEE d MMM yyyy');
  } catch (e) { /* keep raw date */ }
  return 'FC Photography Lab – Booking ' + b.id + ' · ' + (b.student || '') + ' · ' + when + ', ' + (b.time || '');
}

/** What this step is about, shown at the top of each email in the conversation. */
function updateBanner(subject) {
  if (!subject) return '';
  const text = String(subject).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return '<div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#b3261e;padding:10px 4px">' + text + '</div>';
}

// ---------------------------------------------------------------------------
// Conversations (needs Services → Gmail API in the Apps Script editor)
// ---------------------------------------------------------------------------
const THREADS = 'Threads';

function gmailApiOn() {
  return typeof Gmail !== 'undefined' && Gmail.Users && Gmail.Users.Messages;
}

function findThread(key) {
  const sh = sheet(THREADS, ['Key', 'Thread ID', 'Message-ID', 'Subject', 'Started']);
  if (sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][0] === key) return { threadId: rows[i][1], messageId: rows[i][2], subject: rows[i][3] };
  }
  return null;
}

function sendThreaded(key, to, subject, text, html, props, bcc) {
  const th = findThread(key);
  const subj = th ? 'Re: ' + th.subject : subject;
  const raw = buildMime(to, subj, text, html, th ? th.messageId : null, props, bcc);
  const req = { raw: raw };
  if (th && th.threadId) req.threadId = th.threadId;
  const sent = Gmail.Users.Messages.send(req, 'me');
  if (th) return 'sent (reply in conversation)';
  const meta = Gmail.Users.Messages.get('me', sent.id, { format: 'metadata', metadataHeaders: ['Message-Id'] });
  const h = ((meta.payload && meta.payload.headers) || []).filter(function (x) { return String(x.name).toLowerCase() === 'message-id'; })[0];
  const sh = sheet(THREADS, ['Key', 'Thread ID', 'Message-ID', 'Subject', 'Started']);
  sh.appendRow([key, sent.threadId, h ? h.value : '', subject, new Date()]);
  sh.hideSheet();
  return 'sent (new conversation)';
}

function buildMime(to, subject, text, html, inReplyTo, props, bcc) {
  const enc = function (s) { return Utilities.base64Encode(s, Utilities.Charset.UTF_8); };
  const wrap = function (s) { return s.replace(/(.{76})/g, '$1\r\n'); };
  const name = props.getProperty('SENDER_NAME') || 'FC Photography Lab — NIFT Jodhpur';
  const boundary = 'fcb' + Utilities.getUuid().replace(/-/g, '');
  const head = [
    'From: =?UTF-8?B?' + enc(name) + '?= <' + Session.getEffectiveUser().getEmail() + '>',
    'To: ' + to,
    ...(bcc ? ['Bcc: ' + bcc] : []),
    'Subject: =?UTF-8?B?' + enc(subject) + '?=',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) head.push('In-Reply-To: ' + inReplyTo, 'References: ' + inReplyTo);
  const replyTo = props.getProperty('REPLY_TO');
  if (replyTo) head.push('Reply-To: ' + replyTo);
  head.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');
  const mime = head.join('\r\n') + '\r\n\r\n' + [
    '--' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(enc(text)),
    '--' + boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(enc(html)),
    '--' + boundary + '--', '',
  ].join('\r\n');
  return Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8);
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
  // 1. Permission to check sign-ins (the website needs this).
  UrlFetchApp.fetch(DB_URL + '/.json?shallow=true', { muteHttpExceptions: true });
  Logger.log('✓ Can reach Firebase (permission "connect to an external service" is granted).');
  Logger.log(gmailApiOn() ? '✓ Gmail API is on — emails about one booking stay in one conversation.' : '✗ Gmail API is OFF — add it under Services (+) → Gmail API to keep each booking in one conversation.');

  // 2. Two emails about the same booking → they should arrive as ONE conversation.
  const me = Session.getEffectiveUser().getEmail();
  const first = { type: 'test', to: [me], subject: 'Booking submitted – FC-TEST-0001', text: 'Step 1: booking submitted.', html: '<p><b>Step 1:</b> booking submitted.</p>' };
  const second = { type: 'test', to: [me], subject: 'Booking approved – FC-TEST-0001', text: 'Step 2: approved by the FC-CC.', html: '<p><b>Step 2:</b> approved by the FC-CC (reply in the same conversation).</p>' };
  logEmail(first, sample, sendMail(first, props, sample));
  logEmail(second, sample, sendMail(second, props, sample));
  Logger.log('✓ Sent 2 test emails to ' + me + ' — check they are in one conversation.');
}

/** Real emails to students & faculty from now on. */
function goLive() {
  PropertiesService.getScriptProperties().setProperty('TEST_MODE', 'false');
  Logger.log('LIVE: emails now go to the real students and faculty.');
}

/** Stop / start the hidden copy of every email to the sheet owner (live mode). */
function stopCopies() {
  PropertiesService.getScriptProperties().setProperty('COPY_ALL', 'false');
}
function sendCopies() {
  PropertiesService.getScriptProperties().setProperty('COPY_ALL', 'true');
}

/** Back to test mode (all emails to you). */
function backToTestMode() {
  PropertiesService.getScriptProperties().setProperty('TEST_MODE', 'true');
}
