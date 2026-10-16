// Digital signatures for staff approvals, attached documents, and a single
// endpoint that returns every signature on a booking to everyone involved.
import { onCall } from 'firebase-functions/v2/https';

import { db, bucket, fail, getActor, requireRole, auditEntry, actorRef, TS, ADMIN_ROLES } from './core.js';

// Built on first use (not at module load) so the module works in any runtime.
const PNG = () => Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPG = () => Buffer.from([0xff, 0xd8, 0xff]);

/** Decode a PNG signature data URL (drawn on screen). */
export function decodeSignature(dataUrl, { required = true } = {}) {
  if (!dataUrl) {
    if (required) fail('invalid-argument', 'Please draw and submit your digital signature.');
    return null;
  }
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) fail('invalid-argument', 'Please draw and submit your digital signature.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 200 || buf.length > 300 * 1024 || !buf.subarray(0, 4).equals(PNG())) {
    fail('invalid-argument', 'The signature image is invalid. Please sign again.');
  }
  return buf;
}

/** Decode an attached photo/scan (JPEG or PNG, ≤ 3 MB). */
export function decodeDocument(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) fail('invalid-argument', 'Attach a JPG or PNG photo of the signed form.');
  const buf = Buffer.from(m[2], 'base64');
  const ok = m[1] === 'png' ? buf.subarray(0, 4).equals(PNG()) : buf.subarray(0, 3).equals(JPG());
  if (!ok || buf.length > 3 * 1024 * 1024) fail('invalid-argument', 'The attached photo is invalid or larger than 3 MB.');
  return { buf, type: m[1] };
}

const staffSigPath = (uid) => `staffSignatures/${uid}.png`;

async function readFile(path) {
  try {
    const [buf] = await bucket().file(path).download();
    return buf;
  } catch {
    return null;
  }
}

/**
 * Store the approver's signature for one booking step. Uses the freshly drawn
 * signature if given, otherwise a copy of the approver's saved signature (so a
 * later change to their saved signature never alters past approvals).
 * Returns the stored path, or null when none is available and not required.
 */
export async function stampSignature(actor, bookingId, key, { dataUrl = null, required = false } = {}) {
  let buf = decodeSignature(dataUrl, { required: false });
  if (!buf) buf = await readFile(staffSigPath(actor.uid));
  if (!buf) {
    if (required) fail('failed-precondition', 'A digital signature is required. Draw your signature to approve.');
    return null;
  }
  const path = `approvalSignatures/${bookingId}/${key}.png`;
  await bucket().file(path).save(buf, { contentType: 'image/png', resumable: false, metadata: { metadata: { bookingId, signer: actor.uid } } });
  return path;
}

export async function storeDocument(bookingId, key, doc) {
  if (!doc) return null;
  const path = `bookingDocuments/${bookingId}/${key}.${doc.type === 'png' ? 'png' : 'jpg'}`;
  await bucket().file(path).save(doc.buf, { contentType: `image/${doc.type}`, resumable: false, metadata: { metadata: { bookingId } } });
  return path;
}

// ---- Staff: save / read "my signature" -----------------------------------------
export const saveMySignature = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, ADMIN_ROLES, 'Only admins can save an approval signature.');
  const buf = decodeSignature(request.data?.signature);
  await bucket().file(staffSigPath(actor.uid)).save(buf, { contentType: 'image/png', resumable: false });
  const [ap, av] = auditEntry(actorRef(actor), 'STAFF_SIGNATURE_SAVED', {});
  await db.ref().update({ [`admins/${actor.uid}/signatureUpdatedAt`]: TS, [ap]: av });
  return { ok: true };
});

export const getMySignature = onCall(async (request) => {
  const actor = await getActor(request);
  requireRole(actor, ADMIN_ROLES);
  const buf = await readFile(staffSigPath(actor.uid));
  return { dataUrl: buf ? `data:image/png;base64,${buf.toString('base64')}` : null };
});

// ---- Everyone involved sees every signature on the booking ----------------------
export const getBookingSignatures = onCall(async (request) => {
  const actor = await getActor(request);
  const bookingId = String(request.data?.bookingId || '');
  const b = (await db.ref(`bookings/${bookingId}`).get()).val();
  if (!b) fail('not-found', 'Booking not found.');
  const allowed = actor.role || b.studentUid === actor.uid || b.fcStudentUid === actor.uid || b.seniorUid === actor.uid;
  if (!allowed) fail('permission-denied', 'You cannot view the signatures on this booking.');

  const wanted = { student: b.signature?.path };
  for (const [k, st] of Object.entries(b.special?.steps || {})) {
    if (st?.signaturePath) wanted[`special.${k}`] = st.signaturePath;
    if (st?.documentPath) wanted[`doc.${k}`] = st.documentPath;
  }
  if (b.fcccApproval?.signaturePath) wanted.fccc = b.fcccApproval.signaturePath;

  const out = {};
  await Promise.all(
    Object.entries(wanted).map(async ([k, path]) => {
      if (!path) return;
      const buf = await readFile(path);
      if (buf) out[k] = `data:image/${path.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;
    }),
  );
  return { signatures: out };
});
