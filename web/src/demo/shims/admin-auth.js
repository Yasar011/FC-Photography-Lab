// firebase-admin/auth (demo)
import { DEMO_ACCOUNTS } from '../session.js';

export const getAuth = () => ({
  async getUserByEmail(email) {
    const a = DEMO_ACCOUNTS.find((x) => x.email === String(email).toLowerCase());
    if (!a) {
      const err = new Error('There is no user record corresponding to the provided identifier.');
      err.code = 'auth/user-not-found';
      throw err;
    }
    return { uid: a.uid, email: a.email };
  },
});
