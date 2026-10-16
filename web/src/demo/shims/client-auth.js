// firebase/auth (demo) — sign-in is a local account picker (see DemoLogin).
import { currentUser, onSessionChange, signOutDemo } from '../session.js';

const toUser = (a) => (a ? { uid: a.uid, email: a.email, displayName: a.name, emailVerified: true } : null);

export const getAuth = () => ({
  get currentUser() {
    return toUser(currentUser());
  },
});
export const connectAuthEmulator = () => {};

export function onAuthStateChanged(auth, cb) {
  setTimeout(() => cb(toUser(currentUser())), 0);
  return onSessionChange((a) => cb(toUser(a)));
}

export class GoogleAuthProvider {
  setCustomParameters() {}
}

export async function signInWithPopup() {
  const err = new Error('Use the demo account picker.');
  err.code = 'auth/popup-closed-by-user';
  throw err;
}
export async function signInWithRedirect() {}
export async function signOut() {
  signOutDemo();
}
