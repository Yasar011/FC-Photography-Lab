// Email notifications. Two ways to send, both server-side only:
//  • Google Sheet + Apps Script (SHEETS_WEBHOOK_URL set): the script sends the
//    email from the sheet owner's Gmail and keeps one live row per booking.
//  • SMTP (SMTP_USER + SMTP_PASS).
// Every email is logged in /emailLogs.
import nodemailer from 'nodemailer';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

import { db, TS, APP_URL } from './core.js';
import {
  INSTITUTE,
  APP_NAME,
  STATUS_META,
  STUDENT_TYPE_LABELS,
  participantLines,
} from '../shared/constants.js';
import { formatDate, formatRange } from '../shared/calendar.js';

export const SMTP_PASS = defineSecret('SMTP_PASS');
const SMTP_HOST = defineString('SMTP_HOST', { default: 'smtp.gmail.com' });
const SMTP_PORT = defineString('SMTP_PORT', { default: '465' });
const SMTP_USER = defineString('SMTP_USER', { default: '' });
const MAIL_FROM = defineString('MAIL_FROM', { default: '' });
// Apps Script web app URL + shared secret (functions/.env.<project> — never in the frontend).
const SHEETS_WEBHOOK_URL = defineString('SHEETS_WEBHOOK_URL', { default: '' });
const SHEETS_WEBHOOK_SECRET = defineString('SHEETS_WEBHOOK_SECRET', { default: '' });

const sheetsUrl = () => {
  try {
    return SHEETS_WEBHOOK_URL.value();
  } catch {
    return '';
  }
};

/** Booking summary written as one row of the Google Sheet. */
export function sheetBooking(b) {
  if (!b) return null;
  const concern = b.facultyConcern || null;
  return {
    id: b.id,
    status: b.status,
    statusLabel: STATUS_META[b.status]?.label || b.status,
    student: b.studentName,
    email: b.email,
    niftId: b.niftId,
    department: b.department,
    semester: b.semester,
    studentType: STUDENT_TYPE_LABELS[b.studentType] || b.studentType,
    date: b.date,
    time: formatRange(b.startHour, b.endHour),
    hours: b.duration,
    purpose: b.purpose,
    equipment: (b.equipmentList || []).join(', '),
    special: b.isSpecial ? (b.specialReasons || []).join(', ') || 'Yes' : '',
    facultyName: b.faculty?.name || '',
    facultyEmail: b.faculty?.email || '',
    fcStudent: b.fcStudent ? `${b.fcStudent.name} (${b.fcStudent.niftId})` : '',
    people: participantLines(b).join('\n'),
    // Faculty pressed "I DID NOT APPROVE THIS" → the row turns red in the sheet.
    facultySaidNo: Boolean(concern),
    facultyConcernOpen: Boolean(concern && !concern.resolved),
    facultyRemarks: concern?.remarks || '',
    approvedBy: b.fcccApproval?.byName || '',
    link: appLink(`/bookings/${b.id}`),
    createdAt: b.createdAt || null,
    updatedAt: Date.now(),
  };
}

const callerIdToken = async () =>
  typeof globalThis.__fcIdToken === 'function' ? (await globalThis.__fcIdToken()) || undefined : undefined;

/** POST to the Apps Script web app. Throws on any error. */
async function postToSheet(payload) {
  const res = await fetch(sheetsUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Apps Script reads e.postData.contents
    // Server: shared secret. In-browser backend (Spark plan): the user's Firebase ID token.
    body: JSON.stringify({ secret: SHEETS_WEBHOOK_SECRET.value() || undefined, idToken: await callerIdToken(), ...payload }),
    redirect: 'follow',
  });
  const text = await res.text();
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script replied ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!out.ok) throw new Error(out.error || 'Apps Script error');
  return out;
}

/** Update a booking's row in the Google Sheet (for changes that send no email). Never throws. */
export async function syncSheetBooking(b) {
  if (!sheetsUrl() || !b) return;
  try {
    await postToSheet({ action: 'booking', booking: sheetBooking(b) });
  } catch (err) {
    logger.error('Google Sheet sync failed', { bookingId: b.id, err: err.message });
  }
}

let transport;
function getTransport() {
  if (transport) return transport;
  const user = SMTP_USER.value();
  let pass = '';
  try {
    pass = SMTP_PASS.value();
  } catch {
    pass = '';
  }
  if (!user || !pass) return null;
  const port = Number(SMTP_PORT.value() || 465);
  transport = nodemailer.createTransport({
    host: SMTP_HOST.value(),
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transport;
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const appLink = (path) => `${APP_URL.value().replace(/\/$/, '')}${path}`;

export function bookingRows(b) {
  return [
    ['Booking ID', b.id],
    ['Status', STATUS_META[b.status]?.label || b.status],
    ['Student', b.studentName],
    ['NIFT ID', b.niftId],
    ['Department', b.department],
    ['Semester', b.semester],
    ['Student Type', STUDENT_TYPE_LABELS[b.studentType] || b.studentType],
    ['Date', formatDate(b.date, { weekday: true })],
    ['Time', formatRange(b.startHour, b.endHour)],
    ['Duration', `${b.duration} hour${b.duration > 1 ? 's' : ''}`],
    ['Purpose', b.purpose],
    ['Equipment', (b.equipmentList || []).join(', ') || '—'],
  ];
}

export function renderEmail({ heading, intro = [], rows = [], extraRows = [], action, note }) {
  const tr = [...rows, ...extraRows]
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#555;white-space:nowrap;vertical-align:top">${esc(k)}</td>` +
        `<td style="padding:6px 0;color:#111;vertical-align:top">${esc(v).replace(/\n/g, '<br>')}</td></tr>`,
    )
    .join('');
  const paras = intro.map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:20px 0"><a href="${esc(action.url)}" style="display:inline-block;background:#1d1d1f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600">${esc(action.label)}</a></p>` +
      `<p style="margin:0 0 12px;font-size:12px;color:#666">If the button does not work, open: ${esc(action.url)}</p>`
    : '';
  const extraNote = note ? `<p style="margin:16px 0 0;font-size:13px;color:#444">${esc(note)}</p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #ddd">
<tr><td style="padding:18px 24px;border-bottom:3px solid #b3261e">
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#555">${esc(INSTITUTE)}</div>
<div style="font-size:18px;font-weight:700">${esc(APP_NAME)}</div></td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:17px;margin:0 0 16px">${esc(heading)}</h1>${paras}
<table role="presentation" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee;margin-top:8px;width:100%">${tr}</table>
${button}${extraNote}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #eee;font-size:12px;color:#777">This is an automated message from the ${esc(APP_NAME)} booking system, ${esc(INSTITUTE)}. Please do not reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
}

function textVersion({ heading, intro = [], rows = [], extraRows = [], action, note }) {
  return [
    `${INSTITUTE} — ${APP_NAME}`,
    '',
    heading,
    '',
    ...intro,
    '',
    ...[...rows, ...extraRows].filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v}`),
    action ? `\n${action.label}: ${action.url}` : '',
    note ? `\n${note}` : '',
  ].join('\n');
}

/**
 * Send one email and log it. Never throws — email failure must not roll back
 * a booking. `trigger` describes what caused it (e.g. "booking.create").
 */
export async function sendEmail({ type, to, subject, bookingId = null, trigger, content }) {
  const logRef = db.ref('emailLogs').push();
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const log = {
    type,
    recipient: recipients.join(', '),
    subject,
    bookingId,
    trigger,
    status: 'queued',
    createdAt: TS,
  };
  if (!recipients.length) {
    await logRef.set({ ...log, status: 'skipped', error: 'No recipient' });
    return;
  }
  await logRef.set(log);

  // Google Sheet + Apps Script: sends the email and refreshes the booking's row.
  if (sheetsUrl()) {
    try {
      const b = bookingId ? (await db.ref(`bookings/${bookingId}`).get()).val() : null;
      await postToSheet({
        action: 'mail',
        mail: { type, to: recipients, subject, html: renderEmail(content), text: textVersion(content) },
        booking: sheetBooking(b),
      });
      await logRef.update({ status: 'sent', via: 'google-sheets', updatedAt: TS });
    } catch (err) {
      logger.error('Email via Google Sheet failed', { type, bookingId, err: err.message });
      await logRef.update({ status: 'failed', via: 'google-sheets', error: String(err.message).slice(0, 500), updatedAt: TS });
    }
    return;
  }

  const t = getTransport();
  if (!t) {
    await logRef.update({ status: 'not-configured', error: 'Email is not configured (Google Sheet or SMTP)', updatedAt: TS });
    logger.warn('SMTP not configured; email not sent', { type, bookingId });
    return;
  }
  try {
    const info = await t.sendMail({
      from: MAIL_FROM.value() || SMTP_USER.value(),
      to: recipients.join(', '),
      subject,
      html: renderEmail(content),
      text: textVersion(content),
    });
    await logRef.update({ status: 'sent', messageId: info.messageId || null, updatedAt: TS });
  } catch (err) {
    logger.error('Email send failed', { type, bookingId, err: err.message });
    await logRef.update({ status: 'failed', error: String(err.message).slice(0, 500), updatedAt: TS });
  }
}

export const sendAll = (emails) => Promise.allSettled(emails.filter(Boolean).map(sendEmail));

/** Emails of admins holding any of the given roles (from /admins). */
export async function adminEmails(roles) {
  const snap = await db.ref('admins').get();
  const out = [];
  snap.forEach((c) => {
    const a = c.val();
    if (a?.email && roles.includes(a.role)) out.push(a.email);
  });
  return [...new Set(out)];
}
