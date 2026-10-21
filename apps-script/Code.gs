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
  'Open in app', 'Created', 'Last update', 'People (special bookings)',
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

    // A booking released its hours: email students waiting for them (only hours that are free now).
    if (body.action === 'slotFreed') return json(slotFreedFor(body.date));

    // Email the next one-click approver (Dept CC / Director) for this booking.
    if (body.action === 'requestDecision') {
      const id = body.booking && body.booking.id;
      if (!id) return json({ ok: false, error: 'No booking' });
      return json(requestDecisionFor(id));
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
  // Account emails (e.g. "FC-IDM request approved") go to the registered student.
  if (!b && /^idm_/.test(String(mail.type || ''))) {
    const students = readDb('students', idToken) || {};
    Object.keys(students).forEach((k) => add(students[k] && students[k].email));
  }
  // Addresses told when the FC-CC approves (Settings → "Email when the FC-CC approves").
  const notify = readDb('settings/bookingRules/approvalNotifyEmails', idToken);
  (Array.isArray(notify) ? notify : ['admin.jodhpur@nift.ac.in']).forEach(add);
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
    people: (b.participants || []).map(function (p, i) { return (i + 1) + '. ' + p.name + ' · ' + p.department + ' · ' + p.hostel + ', Room ' + p.room; }).join('\n'),
  };
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.t && p.b && p.s) return decisionPage(p);
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
    b.link, b.createdAt ? new Date(b.createdAt) : '', new Date(), b.people || '',
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
  if (sh.getLastRow() > 0 && sh.getLastColumn() < headers.length) {
    // New columns added in an update: extend the header row.
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1d1d1f').setFontColor('#ffffff');
  }
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

// ---------------------------------------------------------------------------
// Daily summary to the FC-CC (about 4:15 PM every day)
// ---------------------------------------------------------------------------
// Setup (once): Project Settings → Script properties → add SA_JSON = the whole
// Firebase service-account key file (JSON). Then run setupDailySummary.

/** Creates the daily 4:15 PM trigger (replaces an old one). */
function setupDailySummary() {
  if (!PropertiesService.getScriptProperties().getProperty('SA_JSON')) throw new Error('Add the SA_JSON script property first (see the comment above).');
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'dailySummary'; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailySummary').timeBased().atHour(16).nearMinute(15).everyDays(1).inTimezone('Asia/Kolkata').create();
  Logger.log('✓ Daily summary scheduled for about 4:15 PM (IST). Run dailySummary now to see one.');
}

/** Google access token for the service account (read the database without a signed-in user). */
function serviceToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sa_token');
  if (cached) return cached;
  const sa = JSON.parse(PropertiesService.getScriptProperties().getProperty('SA_JSON') || '{}');
  if (!sa.client_email || !sa.private_key) throw new Error('SA_JSON script property is missing or invalid.');
  const now = Math.floor(Date.now() / 1000);
  const enc = function (o) { return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, ''); };
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, sa.private_key)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }, muteHttpExceptions: true,
  });
  const token = JSON.parse(res.getContentText()).access_token;
  if (!token) throw new Error('Could not get a service-account token: ' + res.getContentText().slice(0, 200));
  cache.put('sa_token', token, 3000);
  return token;
}

function adminDb(path, query) {
  const res = UrlFetchApp.fetch(DB_URL + '/' + path + '.json?access_token=' + encodeURIComponent(serviceToken()) + (query ? '&' + query : ''), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Database read failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || 'null');
}

function bookingsWithStatus(status) {
  const all = adminDb('bookings', 'orderBy=' + encodeURIComponent('"status"') + '&equalTo=' + encodeURIComponent('"' + status + '"')) || {};
  return Object.keys(all).map(function (k) { return all[k]; })
    .filter(function (b) { return b && b.endAt > Date.now(); })
    .sort(function (a, b) { return a.startAt - b.startAt; });
}

/** Runs from the daily trigger: one email with everything waiting for the FC-CC. */
function dailySummary() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const fccc = bookingsWithStatus('PENDING_FCCC_APPROVAL');
  const special = bookingsWithStatus('PENDING_SPECIAL_APPROVAL');
  const finalReady = special.filter(function (b) { return b.special && b.special.steps && b.special.steps.fcAssistant && b.special.steps.fcAssistant.state === 'approved'; });
  const toPrint = special.filter(function (b) { return finalReady.indexOf(b) < 0; });
  const concerns = bookingsWithStatus('FACULTY_CONCERN');
  const fcStudent = bookingsWithStatus('PENDING_FC_APPROVAL');
  const waiting = fccc.length + finalReady.length + concerns.length;

  const admins = adminDb('admins') || {};
  const to = Object.keys(admins).map(function (k) { return admins[k]; })
    .filter(function (a) { return a && (a.role === 'fccc' || a.role === 'main') && a.email; })
    .map(function (a) { return a.email; });
  if (!to.length) { Logger.log('No FC-CC / Main Admin found.'); return; }

  const esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  const row = function (b) {
    const when = Utilities.formatDate(new Date(b.date + 'T12:00:00+05:30'), 'Asia/Kolkata', 'EEE d MMM') + ', ' + hourLabel(b.startHour) + ' – ' + hourLabel(b.endHour);
    const todayTag = b.date === today ? ' <b style="color:#b3261e">TODAY</b>' : '';
    return '<tr><td style="padding:6px 10px 6px 0;white-space:nowrap">' + esc(when) + todayTag + '</td>' +
      '<td style="padding:6px 10px 6px 0"><b>' + esc(b.studentName) + '</b> · ' + esc(b.niftId) + ' · ' + esc(TYPE_LABELS[b.studentType] || b.studentType) + '<br><span style="color:#555">' + esc(b.purpose) + '</span></td>' +
      '<td style="padding:6px 0;white-space:nowrap"><a href="' + APP_URL + '/bookings/' + b.id + '">' + esc(b.id) + '</a></td></tr>';
  };
  const section = function (title, list, note) {
    if (!list.length) return '';
    return '<h3 style="font-size:15px;margin:22px 0 6px">' + esc(title) + ' (' + list.length + ')</h3>' +
      (note ? '<p style="margin:0 0 6px;color:#555;font-size:13px">' + esc(note) + '</p>' : '') +
      '<table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;border-top:1px solid #eee">' + list.map(row).join('') + '</table>';
  };
  const dateLabel = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'EEEE d MMMM yyyy');
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:640px">' +
    '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#555">NIFT Jodhpur · FC Photography Lab</div>' +
    '<h2 style="margin:4px 0 4px">' + (waiting ? waiting + ' booking' + (waiting > 1 ? 's' : '') + ' waiting for you' : 'Nothing waiting for you ✓') + '</h2>' +
    '<div style="color:#555">' + esc(dateLabel) + ' · daily summary</div>' +
    section('Waiting for your approval', fccc, 'Normal bookings — nothing is confirmed until you Sign & approve.') +
    section('Special — final approval', finalReady, 'Form issued; approve when the signed paper form comes back.') +
    section('Faculty concerns', concerns, 'The faculty said "I did not approve this" — your decision is needed.') +
    section('For information: waiting for the FC student', fcStudent) +
    section('For information: special forms not yet printed', toPrint) +
    '<p style="margin:24px 0 0"><a href="' + APP_URL + '/admin/approvals" style="background:#1d1d1f;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600">Open Approvals</a></p></div>';
  const text = (waiting ? waiting + ' booking(s) waiting for you' : 'Nothing waiting for you') + ' — ' + dateLabel + '\n' + APP_URL + '/admin/approvals';
  const mail = { type: 'daily_summary', to: to, subject: 'FC Photography Lab – ' + (waiting ? waiting + ' waiting for you' : 'nothing waiting') + ' · ' + dateLabel, html: html, text: text };
  logEmail(mail, null, sendMail(mail, props, null));
}

// ---------------------------------------------------------------------------
// One-click approvals: Dept CC and Director (no sign-in)
// ---------------------------------------------------------------------------
// The website asks for the email (action "requestDecision"). This script makes
// a long random link itself, stores only its hash in the database, and emails
// Approve / Reject buttons. The link opens a page here where remarks are
// required. Needs the SA_JSON script property (see "Daily summary").

const STEPS = {
  deptCc: { status: 'PENDING_DEPT_CC', field: 'deptCcApproval', next: 'PENDING_FCCC_APPROVAL' },
  director: { status: 'PENDING_DIRECTOR', field: 'directorApproval', next: 'APPROVED' },
};

function stepFor(b) {
  if (!b) return null;
  if (b.status === 'PENDING_DEPT_CC') return 'deptCc';
  if (b.status === 'PENDING_DIRECTOR') return 'director';
  return null;
}

function stepLabel(step, b) {
  return step === 'director' ? 'Director' : (b.department || 'Dept') + ' CC';
}

/** Who approves this step: Settings → Director / Dept CC emails; else the Main Admin(s). */
function approverEmails(step, b) {
  const rules = adminDb('settings/bookingRules') || {};
  const set = step === 'director' ? rules.directorEmail : (rules.deptCcEmails || {})[b.department];
  if (set) return { to: [String(set).toLowerCase()], fallback: false };
  const admins = adminDb('admins') || {};
  const main = Object.keys(admins).map(function (k) { return admins[k]; })
    .filter(function (a) { return a && a.role === 'main' && a.email; })
    .map(function (a) { return a.email; });
  return { to: main, fallback: true };
}

function sha256Hex(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join('');
}

function adminPatch(updates) {
  const res = UrlFetchApp.fetch(DB_URL + '/.json?access_token=' + encodeURIComponent(serviceToken()), {
    method: 'patch', contentType: 'application/json', payload: JSON.stringify(updates), muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('Database write failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
}

const escHtml = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

function peopleLines(b) {
  return (b.participants || []).map(function (p, i) { return (i + 1) + '. ' + p.name + ' · ' + p.department + ' · Hostel ' + p.hostel + ', Room ' + p.room; });
}

function bookingRowsHtml(b) {
  const when = Utilities.formatDate(new Date(b.date + 'T12:00:00+05:30'), 'Asia/Kolkata', 'EEE d MMM yyyy') + ', ' + hourLabel(b.startHour) + ' – ' + hourLabel(b.endHour);
  const rows = [
    ['Booking ID', b.id], ['Student', b.studentName + ' (' + b.niftId + ')'], ['Department / Sem', b.department + ' · Semester ' + b.semester],
    ['When', when + (b.isSpecial ? ' — SPECIAL (' + (b.specialReasons || []).join(', ') + ')' : '')],
    ['Purpose', b.purpose], ['Equipment', (b.equipmentList || []).join(', ')],
    ['Faculty', b.faculty ? b.faculty.name + ' <' + b.faculty.email + '>' : ''],
    ['FC student', b.fcStudent ? b.fcStudent.name + ' (' + b.fcStudent.niftId + ')' : ''],
    ['People using the lab (' + (b.participants || []).length + ')', peopleLines(b).join('\n')],
  ].filter(function (r) { return r[1]; });
  return '<table cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #eee;font-size:14px">' + rows.map(function (r) {
    return '<tr><td style="padding:6px 12px 6px 0;color:#555;white-space:nowrap;vertical-align:top">' + escHtml(r[0]) + '</td><td style="padding:6px 0;vertical-align:top">' + escHtml(r[1]).replace(/\n/g, '<br>') + '</td></tr>';
  }).join('') + '</table>';
}

function mailFrame(heading, introHtml, bodyHtml) {
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:620px">' +
    '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#555">NIFT Jodhpur · FC Photography Lab</div>' +
    '<h2 style="margin:6px 0 10px;font-size:18px">' + escHtml(heading) + '</h2>' + introHtml + bodyHtml +
    '<p style="margin:18px 0 0;font-size:12px;color:#777">Automated message from the FC Photography Lab booking system.</p></div>';
}

/** Make a new one-click link for the current step and email it to the approver. */
function requestDecisionFor(bookingId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const b = adminDb('bookings/' + bookingId);
    const step = stepFor(b);
    if (!step) return { ok: false, error: 'This booking is not waiting for the Dept CC or the Director.' };
    const who = approverEmails(step, b);
    if (!who.to.length) return { ok: false, error: 'No email set for the ' + stepLabel(step, b) + ' (Settings).' };
    const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    const upd = {};
    upd['decisionTokens/' + bookingId + '/' + step] = { hash: sha256Hex(token), to: who.to.join(', '), createdAt: Date.now() };
    adminPatch(upd);

    const base = ScriptApp.getService().getUrl();
    const link = function (d) { return base + '?b=' + encodeURIComponent(bookingId) + '&s=' + step + '&t=' + token + '&d=' + d; };
    const label = stepLabel(step, b);
    const btn = function (href, text, color) {
      return '<a href="' + href + '" style="display:inline-block;background:' + color + ';color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:6px;margin-right:10px">' + text + '</a>';
    };
    const intro = (who.fallback ? '<p style="background:#fff4e5;padding:8px 10px;border-radius:6px"><b>No ' + escHtml(label) + ' email is set in Settings</b>, so this request came to you (Main Admin). Please forward it, or set the email under Rules &amp; questions.</p>' : '') +
      '<p>' + escHtml(b.studentName) + ' has requested the FC Photography Lab. Your approval as <b>' + escHtml(label) + '</b> is needed. Remarks are required for both Approve and Reject.</p>' +
      '<p style="margin:16px 0">' + btn(link('approve'), '✓ Approve', '#188038') + btn(link('reject'), '✕ Reject', '#b3261e') + '</p>';
    const html = mailFrame(label + ' approval needed — ' + b.id, intro, bookingRowsHtml(b));
    const mail = { type: 'decision_request_' + step, to: who.to, subject: label + ' approval needed – ' + b.id, html: html, text: 'Approve or reject: ' + link('approve') + '\n' + link('reject') };
    const props = PropertiesService.getScriptProperties();
    logEmail(mail, summarize(b), sendMail(mail, props, summarize(b)));
    return { ok: true, sentTo: who.to.join(', ') };
  } finally {
    lock.releaseLock();
  }
}

/** Checks a one-click link. Returns { b, step } or { error }. */
function checkDecisionLink(bookingId, step, token) {
  if (!STEPS[step] || !/^FC-\d{6}-\d{4,}$/.test(String(bookingId || '')) || !/^[a-f0-9]{64}$/.test(String(token || ''))) return { error: 'This link is not valid.' };
  const rec = adminDb('decisionTokens/' + bookingId + '/' + step);
  if (!rec || rec.hash !== sha256Hex(token)) return { error: 'This link is not valid or a newer one was sent.' };
  if (rec.usedAt) return { error: 'This decision has already been recorded. Thank you.' };
  const b = adminDb('bookings/' + bookingId);
  if (!b) return { error: 'Booking not found.' };
  if (b.status === 'FACULTY_CONCERN') return { error: 'This booking is on hold: the faculty raised a concern. The FC-CC will decide first; you will get a new email if your approval is still needed.' };
  if (b.status !== STEPS[step].status) return { error: 'This booking is no longer waiting for this approval (now: ' + (STATUS_LABELS[b.status] || b.status) + ').' };
  if (b.endAt && b.endAt < Date.now()) return { error: 'This booking time has already passed.' };
  return { b: b, step: step };
}

function decisionPage(p) {
  const chk = checkDecisionLink(p.b, p.s, p.t);
  const shell = function (inner) {
    return HtmlService.createHtmlOutput('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>FC Photography Lab — Approval</title>' +
      '<style>body{margin:0;background:#f4f2ee;font-family:Arial,sans-serif;color:#141414}main{max-width:640px;margin:0 auto;padding:20px}' +
      '.card{background:#fff;border-radius:14px;padding:20px;margin-top:14px}h1{font-size:22px;margin:0 0 6px}label{font-weight:700;display:block;margin:14px 0 6px}' +
      'textarea{width:100%;box-sizing:border-box;min-height:90px;font:inherit;padding:10px;border:1px solid #bbb;border-radius:8px}' +
      '.opts{display:flex;gap:10px;flex-wrap:wrap}.opts label{font-weight:600;display:flex;gap:6px;align-items:center;border:2px solid #ddd;border-radius:10px;padding:10px 14px;margin:0;cursor:pointer}' +
      'button{margin-top:16px;background:#141414;color:#fff;border:0;border-radius:8px;padding:14px 22px;font-size:16px;font-weight:700;cursor:pointer;min-height:48px}' +
      '.err{color:#b3261e;font-weight:700}.ok{color:#188038;font-weight:700}</style></head><body><main>' +
      '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#555">NIFT Jodhpur · FC Photography Lab</div>' + inner + '</main></body></html>')
      .setTitle('FC Photography Lab — Approval').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  };
  if (chk.error) return shell('<div class="card"><h1>Approval</h1><p class="err">' + escHtml(chk.error) + '</p></div>');
  const b = chk.b;
  const label = stepLabel(chk.step, b);
  const pre = p.d === 'reject' ? 'reject' : 'approve';
  return shell('<div class="card"><h1>' + escHtml(label) + ' approval — ' + escHtml(b.id) + '</h1>' + bookingRowsHtml(b) + '</div>' +
    '<div class="card"><form id="f" onsubmit="return send(event)">' +
    '<div class="opts"><label><input type="radio" name="d" value="approve"' + (pre === 'approve' ? ' checked' : '') + '> ✓ Approve</label>' +
    '<label><input type="radio" name="d" value="reject"' + (pre === 'reject' ? ' checked' : '') + '> ✕ Reject</label></div>' +
    '<label for="r">Remarks (required)</label><textarea id="r" required minlength="3" maxlength="500" placeholder="Your remarks"></textarea>' +
    '<button id="go" type="submit">Submit decision</button><p id="msg" aria-live="polite"></p></form></div>' +
    '<script>function send(e){e.preventDefault();var r=document.getElementById("r").value.trim();var m=document.getElementById("msg");' +
    'if(r.length<3){m.className="err";m.textContent="Please write your remarks.";return false;}' +
    'var d=document.querySelector("input[name=d]:checked").value;document.getElementById("go").disabled=true;m.className="";m.textContent="Saving…";' +
    'google.script.run.withSuccessHandler(function(x){m.className=x.ok?"ok":"err";m.textContent=x.message;if(!x.ok)document.getElementById("go").disabled=false;})' +
    '.withFailureHandler(function(err){m.className="err";m.textContent=String(err&&err.message||err);document.getElementById("go").disabled=false;})' +
    '.submitDecision(' + JSON.stringify(b.id) + ',' + JSON.stringify(chk.step) + ',' + JSON.stringify(p.t) + ',d,r);return false;}</script>');
}

function signCode() {
  let h = 0x811c9dc5;
  const str = Array.prototype.slice.call(arguments).join('|');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16).toUpperCase()).slice(-8);
}

/** Called from the decision page. Records the decision and moves the booking on. */
function submitDecision(bookingId, step, token, decision, remarks) {
  remarks = String(remarks || '').trim().slice(0, 500);
  if (remarks.length < 3) return { ok: false, message: 'Please write your remarks.' };
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, message: 'Choose Approve or Reject.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const chk = checkDecisionLink(bookingId, step, token);
    if (chk.error) return { ok: false, message: chk.error };
    const b = chk.b;
    const label = stepLabel(step, b);
    const who = approverEmails(step, b);
    const now = Date.now();
    const approve = decision === 'approve';
    const next = approve ? STEPS[step].next : 'REJECTED';
    const record = {
      decision: decision, byName: label, byEmail: who.to.join(', '), at: now, remarks: remarks,
      signature: approve ? { digital: true, name: label, id: who.to[0] || null, role: label, at: now, code: 'FPL-NJ-' + signCode(bookingId, label, who.to[0], label, now) } : null,
    };
    const hKey = 'z' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const event = approve
      ? (step === 'director' ? 'APPROVED BY THE DIRECTOR — BOOKING CONFIRMED' : label.toUpperCase() + ' APPROVED — SENT TO FC-CC')
      : 'REJECTED BY THE ' + label.toUpperCase();
    const upd = {};
    const base = 'bookings/' + bookingId + '/';
    upd[base + 'status'] = next;
    upd[base + 'updatedAt'] = now;
    upd[base + STEPS[step].field] = record;
    upd[base + 'history/' + hKey] = { at: now, status: next, event: event, by: label, uid: 'email:' + step, role: step, note: remarks };
    if (!approve) upd[base + 'rejection'] = { byUid: 'email:' + step, byName: label, role: step, at: now, reason: label + ': ' + remarks };
    for (let h = b.startHour; h < b.endHour; h++) {
      const k = 'bookingSlots/' + b.date + '/h' + ('0' + h).slice(-2);
      upd[approve ? k + '/status' : k] = approve ? next : null;
    }
    upd['decisionTokens/' + bookingId + '/' + step + '/usedAt'] = now;
    upd['auditLogs/' + hKey] = { uid: 'system', name: label + ' (email link)', role: step, action: (step === 'director' ? 'DIRECTOR_' : 'DEPT_CC_') + (approve ? 'APPROVED' : 'REJECTED'), bookingId: bookingId, niftId: b.niftId, details: { remarks: remarks }, at: now };
    adminPatch(upd);

    const after = adminDb('bookings/' + bookingId);
    const sum = summarize(after);
    upsertBooking(sum);
    notifyAfterDecision(after, step, approve, label, remarks);
    if (!approve) slotFreedFor(b.date);
    return { ok: true, message: approve ? 'Approved. Thank you — the next person has been informed.' : 'Rejected. The student has been informed.' };
  } finally {
    lock.releaseLock();
  }
}

function notifyAfterDecision(b, step, approve, label, remarks) {
  const props = PropertiesService.getScriptProperties();
  const sum = summarize(b);
  const send = function (type, to, subject, heading, introHtml) {
    if (!to || !to.length) return;
    const mail = { type: type, to: to, subject: subject, html: mailFrame(heading, introHtml, bookingRowsHtml(b)), text: heading + '\n' + APP_URL + '/bookings/' + b.id };
    logEmail(mail, sum, sendMail(mail, props, sum));
  };
  const link = '<p><a href="' + APP_URL + '/bookings/' + b.id + '">Open the booking</a></p>';
  const rem = '<p><b>Remarks:</b> ' + escHtml(remarks) + '</p>';
  const admins = adminDb('admins') || {};
  const fccc = Object.keys(admins).map(function (k) { return admins[k]; }).filter(function (a) { return a && (a.role === 'fccc' || a.role === 'main') && a.email; }).map(function (a) { return a.email; });
  if (!approve) {
    send('booking_rejected', [b.email], 'Rejected by the ' + label + ' – ' + b.id, 'Your booking was not approved', '<p>The ' + escHtml(label) + ' rejected your booking. The slot has been released.</p>' + rem + link);
    if (step === 'director') send('director_rejected', fccc, 'Director rejected – ' + b.id, 'The Director rejected a booking you approved', rem + link);
    return;
  }
  if (step === 'deptCc') {
    send('step_approved', [b.email], label + ' approved – ' + b.id, label + ' approved your booking', '<p>Your booking is now with the FC-CC. It is confirmed only after the last approval.</p>' + rem + link);
    send('fccc_approval_needed', fccc, 'Waiting for your approval – ' + b.id, 'A booking is waiting for your approval', '<p>The ' + escHtml(label) + ' approved this booking. Please Sign &amp; approve or reject it in the portal.</p>' + rem +
      '<p><a href="' + APP_URL + '/admin/approvals" style="background:#141414;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600">Open Approvals</a></p>');
    return;
  }
  // Director approved → confirmed: student + institute admin (with everyone's hostel and room).
  send('booking_approved', [b.email], 'Approved – FC Photography Lab booking ' + b.id, 'Your booking is approved', '<p>The Director approved your special booking. It is confirmed. No printing is needed; the institute admin has been informed. Show your Booking ID and NIFT ID card at the lab.</p>' + rem + link);
  const rules = adminDb('settings/bookingRules') || {};
  const notify = Array.isArray(rules.approvalNotifyEmails) ? rules.approvalNotifyEmails : ['admin.jodhpur@nift.ac.in'];
  send('admin_approval_notice', notify, 'Approved (special permission) – FC Photography Lab booking ' + b.id, 'Special booking approved — FC-CC and Director',
    '<p>This special-permission booking (' + escHtml((b.specialReasons || []).join(', ')) + ') is approved by the FC-CC and the Director. Everyone using the lab is listed below with hostel and room.</p>' + link);
}

// ---------------------------------------------------------------------------
// "Notify me if it frees up" — students watching hours another booking held
// ---------------------------------------------------------------------------
/** Hours on `date` were released: email everyone watching an hour that is free now. */
function slotFreedFor(date) {
  date = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Bad date' };
  const all = adminDb('slotWatch') || {};
  const day = adminDb('bookingSlots/' + date) || {};
  const now = new Date();
  const today = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
  const nowH = Number(Utilities.formatDate(now, 'Asia/Kolkata', 'H'));
  const upd = {};
  const who = {};
  Object.keys(all).forEach(function (uid) {
    const list = all[uid] || {};
    Object.keys(list).forEach(function (k) {
      const w = list[k];
      const path = 'slotWatch/' + uid + '/' + k;
      if (!w || !w.date || w.date < today || (w.date === today && Number(w.hour) <= nowH)) { upd[path] = null; return; } // old
      if (w.date !== date || day['h' + ('0' + w.hour).slice(-2)]) return; // another day, or still taken
      upd[path] = null; // tell them once
      if (!String(w.email || '').toLowerCase().endsWith(ALLOWED_DOMAIN)) return;
      (who[uid] = who[uid] || { email: w.email, name: w.name || '', hours: [] }).hours.push(Number(w.hour));
    });
  });
  if (Object.keys(upd).length) adminPatch(upd);

  const props = PropertiesService.getScriptProperties();
  const dayLabel = Utilities.formatDate(new Date(date + 'T12:00:00+05:30'), 'Asia/Kolkata', 'EEE d MMM yyyy');
  let sent = 0;
  Object.keys(who).forEach(function (uid) {
    const p = who[uid];
    p.hours.sort(function (a, b) { return a - b; });
    const times = p.hours.map(function (h) { return hourLabel(h) + '–' + hourLabel(h + 1); }).join(', ');
    const link = APP_URL + '/book?date=' + date + '&start=' + p.hours[0] + '&end=' + (p.hours[0] + 1);
    const intro = '<p>Hi ' + escHtml(p.name) + ', the booking on <b>' + escHtml(dayLabel) + '</b> at <b>' + escHtml(times) + '</b> was cancelled, so this time is free again.</p>' +
      '<p>It is first come, first served — book it now if you still need it.</p>' +
      '<p style="margin:16px 0"><a href="' + link + '" style="display:inline-block;background:#2f5bd3;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Book this slot</a></p>';
    const mail = { type: 'slot_free', to: [p.email], subject: 'Lab slot free – ' + dayLabel + ', ' + times, html: mailFrame('A lab slot you wanted is free', intro, ''), text: 'Free again: ' + dayLabel + ', ' + times + '\nBook: ' + link };
    try {
      logEmail(mail, null, sendMail(mail, props, null));
      sent++;
    } catch (err) {
      logEmail(mail, null, 'failed: ' + (err && err.message || err));
    }
  });
  return { ok: true, sent: sent };
}
