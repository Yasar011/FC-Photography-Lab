// firebase-admin/storage → no Cloud Storage on the Spark plan. Signatures are
// text stamps now; the few files that remain (older drawn signatures, if any)
// are kept in the Realtime Database under the booking they belong to.
import { Buffer } from 'buffer';
import { ref as dbRef, get, update, serverTimestamp } from 'firebase/database';
import { db, auth } from '../../firebase.js';

/** Logical storage path → database location. */
export function fileLocation(path) {
  let m;
  if ((m = /^signatures\/([^/]+)\.png$/.exec(path))) return `files/${m[1]}/student`;
  if ((m = /^approvalSignatures\/([^/]+)\/([\w-]+)\.png$/.exec(path))) return `files/${m[1]}/sig_${m[2]}`;
  if ((m = /^bookingDocuments\/([^/]+)\/([\w-]+)\.(png|jpg)$/.exec(path))) return `files/${m[1]}/doc_${m[2]}`;
  if ((m = /^staffSignatures\/([\w-]+)\.png$/.exec(path))) return `staffSignatures/${m[1]}`;
  throw new Error(`Unsupported file path: ${path}`);
}

export const getStorage = () => ({
  bucket: () => ({
    file: (path) => ({
      async save(buf, opts = {}) {
        const b = Buffer.from(buf);
        await update(dbRef(db), {
          [fileLocation(path)]: {
            b64: b.toString('base64'),
            type: opts.contentType || 'image/png',
            bytes: b.length,
            uid: auth.currentUser?.uid || null,
            at: serverTimestamp(),
          },
        });
      },
      async download() {
        const snap = await get(dbRef(db, fileLocation(path)));
        if (!snap.exists()) throw new Error(`No such object: ${path}`);
        return [Buffer.from(snap.val().b64, 'base64')];
      },
    }),
  }),
});
