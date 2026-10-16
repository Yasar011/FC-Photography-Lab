// Sign-in sync, student registration and profile updates.
import { onCall } from 'firebase-functions/v2/https';

import {
  db,
  fail,
  getActor,
  ensureDefaults,
  auditEntry,
  str,
  TS,
  MAIN_ADMIN_EMAILS,
} from './core.js';
import {
  DEPARTMENTS,
  ACCOUNT_STATUS,
  ROLES,
  defaultStudentType,
  isValidNiftId,
  isValidSemester,
  isPhone,
  niftKey,
  normalizeNiftId,
  emailKey,
} from '../shared/constants.js';

/** Called after every sign-in: seeds settings, applies admin invites/bootstrap. */
export const syncAccount = onCall(async (request) => {
  const actor = await getActor(request);
  await ensureDefaults();

  let role = actor.role;
  if (!role) {
    const bootstrap = MAIN_ADMIN_EMAILS.value()
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const invite = (await db.ref(`adminInvites/${emailKey(actor.email)}`).get()).val();
    const granted = bootstrap.includes(actor.email) ? ROLES.MAIN : invite?.role || null;
    if (granted) {
      role = granted;
      const by = { uid: 'system', name: bootstrap.includes(actor.email) ? 'Bootstrap' : invite?.invitedByName || 'System' };
      const [ap, av] = auditEntry({ ...by, role: 'system' }, 'ROLE_ASSIGNED', { details: { email: actor.email, role } });
      await db.ref().update({
        [`roles/${actor.uid}`]: { role, email: actor.email, assignedAt: TS, assignedBy: by.name },
        [`admins/${actor.uid}`]: { email: actor.email, name: actor.name, role, addedAt: TS, addedBy: by.name },
        [`adminInvites/${emailKey(actor.email)}`]: null,
        [ap]: av,
      });
    }
  } else {
    // keep the admin directory name/email fresh
    await db.ref(`admins/${actor.uid}`).update({ email: actor.email, name: actor.name, lastSeenAt: TS });
  }
  if (actor.profile) await db.ref(`users/${actor.uid}/lastLoginAt`).set(TS);
  return { role: role || null, hasProfile: Boolean(actor.profile?.niftId) };
});

/** First-login registration. NIFT ID uniqueness is enforced with a transaction. */
export const registerStudent = onCall(async (request) => {
  const actor = await getActor(request);
  if (actor.profile?.niftId) fail('already-exists', 'You are already registered.');
  const d = request.data || {};
  const name = str(d.name, 100);
  const niftId = normalizeNiftId(d.niftId);
  const phone = str(d.phone, 20);
  const department = str(d.department, 5).toUpperCase();
  const semester = Number(d.semester);

  if (name.length < 3) fail('invalid-argument', 'Please enter your full name.');
  if (!isValidNiftId(niftId)) fail('invalid-argument', 'Please enter a valid NIFT ID (letters, numbers, "/" or "-").');
  if (!isPhone(phone)) fail('invalid-argument', 'Please enter a valid phone number.');
  if (!DEPARTMENTS.includes(department)) fail('invalid-argument', 'Please select your department.');
  if (!isValidSemester(department, semester)) fail('invalid-argument', 'Please select a valid semester for your department.');

  const key = niftKey(niftId);
  const claim = await db.ref(`students/${key}`).transaction((cur) => {
    if (cur && cur.uid && cur.uid !== actor.uid) return undefined; // taken
    return { uid: actor.uid, niftId, registeredAt: Date.now() };
  });
  if (!claim.committed || claim.snapshot.val()?.uid !== actor.uid) {
    fail('already-exists', 'This NIFT ID is already registered. If this is your ID, please contact the FC Staff.');
  }

  const now = Date.now();
  const studentType = defaultStudentType(department);
  const profile = {
    uid: actor.uid,
    name,
    niftId,
    email: actor.email, // always from Google Authentication, never user-entered
    phone,
    department,
    semester,
    studentType,
    status: ACCOUNT_STATUS.ACTIVE,
    bookingAccess: true,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
  const [ap, av] = auditEntry({ uid: actor.uid, name, role: 'student' }, 'REGISTRATION', {
    niftId,
    details: { department, semester, studentType },
  });
  try {
    await db.ref().update({
      [`users/${actor.uid}`]: profile,
      [`students/${key}`]: { uid: actor.uid, niftId, name, department, semester, studentType, status: profile.status, registeredAt: now },
      [ap]: av,
    });
  } catch (err) {
    await db.ref(`students/${key}`).remove();
    throw err;
  }
  return { ok: true };
});

/** Students may only change their phone number themselves. */
export const updateMyProfile = onCall(async (request) => {
  const actor = await getActor(request);
  if (!actor.profile) fail('failed-precondition', 'Please complete your registration first.');
  const phone = str(request.data?.phone, 20);
  if (!isPhone(phone)) fail('invalid-argument', 'Please enter a valid phone number.');
  const [ap, av] = auditEntry({ uid: actor.uid, name: actor.name, role: actor.role || 'student' }, 'PROFILE_UPDATED', {
    niftId: actor.profile.niftId,
    details: { phone },
  });
  await db.ref().update({ [`users/${actor.uid}/phone`]: phone, [`users/${actor.uid}/updatedAt`]: TS, [ap]: av });
  return { ok: true };
});
