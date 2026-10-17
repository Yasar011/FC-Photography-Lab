// firebase-admin/auth → find an existing account's uid by email (Main Admin only).
import { ref as dbRef, get, query, orderByChild, equalTo } from 'firebase/database';
import { db } from '../../firebase.js';

async function findUid(path, email) {
  try {
    const snap = await get(query(dbRef(db, path), orderByChild('email'), equalTo(email)));
    let uid = null;
    snap.forEach((c) => {
      uid = c.key;
      return true;
    });
    return uid;
  } catch {
    return null;
  }
}

export const getAuth = () => ({
  async getUserByEmail(email) {
    const e = String(email).toLowerCase();
    const uid = (await findUid('users', e)) || (await findUid('admins', e));
    if (!uid) {
      const err = new Error('There is no user record corresponding to the provided identifier.');
      err.code = 'auth/user-not-found';
      throw err;
    }
    return { uid, email: e };
  },
});
