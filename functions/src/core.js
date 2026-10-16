// Core helpers: Firebase Admin, caller identity, roles, settings, audit log.
import { initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';

import { ROLES, isAllowedEmail } from '../shared/constants.js';
import {
  DEFAULT_SETTINGS,
  DEFAULT_EQUIPMENT,
  withRuleDefaults,
} from '../shared/defaults.js';

setGlobalOptions({ region: 'asia-south1', maxInstances: 10, memory: '256MiB' });

initializeApp();
export const db = getDatabase();
export const bucket = () => getStorage().bucket();
export const TS = ServerValue.TIMESTAMP;

// Comma-separated list of emails that are always Main Admin (bootstrap).
export const MAIN_ADMIN_EMAILS = defineString('MAIN_ADMIN_EMAILS', { default: '' });
export const APP_URL = defineString('APP_URL', { default: 'http://localhost:5173' });

export const fail = (code, message, details) => {
  throw new HttpsError(code, message, details);
};

export const ADMIN_ROLES = [ROLES.MAIN, ROLES.STAFF, ROLES.FCCC];
export const BOOKING_STAFF_ROLES = [ROLES.MAIN, ROLES.STAFF];

/** Resolve and verify the caller. Every callable starts here. */
export async function getActor(request) {
  if (!request.auth) {
    fail('unauthenticated', 'Please sign in with your NIFT Google account to continue.');
  }
  const { uid, token } = request.auth;
  const email = String(token.email || '').toLowerCase();
  if (!email || token.email_verified !== true || !isAllowedEmail(email)) {
    fail('permission-denied', 'Only verified NIFT Google accounts can use this system.');
  }
  const [roleSnap, userSnap] = await Promise.all([
    db.ref(`roles/${uid}`).get(),
    db.ref(`users/${uid}`).get(),
  ]);
  const role = roleSnap.child('role').val() || null;
  const profile = userSnap.val();
  return {
    uid,
    email,
    role: ADMIN_ROLES.includes(role) ? role : null,
    profile,
    name: profile?.name || token.name || email,
  };
}

export function requireRole(actor, roles, message = 'You do not have permission for this action.') {
  if (!actor.role || !roles.includes(actor.role)) fail('permission-denied', message);
}

export const actorRef = (actor) => ({
  uid: actor.uid,
  name: actor.name,
  role: actor.role || 'student',
  email: actor.email,
});

// ---- Settings ---------------------------------------------------------------
export async function loadSettings() {
  const [settingsSnap, equipmentSnap] = await Promise.all([
    db.ref('settings').get(),
    db.ref('equipment').get(),
  ]);
  const s = settingsSnap.val() || {};
  return {
    bookingRules: withRuleDefaults(s.bookingRules),
    questions: s.questions ?? DEFAULT_SETTINGS.questions,
    declaration: s.declaration ?? DEFAULT_SETTINGS.declaration,
    instructions: s.instructions ?? DEFAULT_SETTINGS.instructions,
    academicCalendar: { ...DEFAULT_SETTINGS.academicCalendar, ...(s.academicCalendar || {}) },
    equipment: equipmentSnap.val() ?? DEFAULT_EQUIPMENT,
  };
}

/** Write default configuration on first run (only for missing sections). */
export async function ensureDefaults() {
  const snap = await db.ref('settings/initializedAt').get();
  if (snap.exists()) return;
  const [settingsSnap, equipmentSnap] = await Promise.all([
    db.ref('settings').get(),
    db.ref('equipment').get(),
  ]);
  const existing = settingsSnap.val() || {};
  const updates = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) updates[`settings/${key}`] = value;
  }
  if (!equipmentSnap.exists()) updates.equipment = DEFAULT_EQUIPMENT;
  updates['settings/initializedAt'] = TS;
  await db.ref().update(updates);
}

// ---- Audit log --------------------------------------------------------------
export function auditEntry(actor, action, { bookingId = null, niftId = null, details = null } = {}) {
  const ref = db.ref('auditLogs').push();
  return [
    `auditLogs/${ref.key}`,
    {
      uid: actor?.uid || 'system',
      name: actor?.name || 'System',
      role: actor?.role || (actor?.uid === 'system' || !actor ? 'system' : 'student'),
      action,
      bookingId,
      niftId,
      details,
      at: TS,
    },
  ];
}

export async function audit(actor, action, extra) {
  const [path, value] = auditEntry(actor, action, extra);
  await db.ref(path).set(value);
}

export const SYSTEM_ACTOR = { uid: 'system', name: 'System (scheduled)', role: 'system' };

export function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}
