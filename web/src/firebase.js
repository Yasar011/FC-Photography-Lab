import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';

const env = import.meta.env;

// `vite --mode demo` runs the whole system in the browser (see src/demo).
export const DEMO = import.meta.env.MODE === 'demo'; // literal so production builds drop all demo code
export const firebaseConfigured = DEMO || Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_DATABASE_URL);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY || 'missing',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || 'https://missing-default-rtdb.firebaseio.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'missing',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
export const db = getDatabase(app);
export const functions = getFunctions(app, env.VITE_FUNCTIONS_REGION || 'asia-south1');

if (!DEMO && env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export const ALLOWED_DOMAIN = env.VITE_ALLOWED_DOMAIN || 'nift.ac.in';

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: 'select_account' });

/** Call a Cloud Function and return its data; errors carry a readable message. */
export async function call(name, data = {}) {
  try {
    const res = await httpsCallable(functions, name, { timeout: 60000 })(data);
    return res.data;
  } catch (err) {
    const generic = !err?.message || err.code === 'functions/internal' || err.code === 'functions/unavailable';
    const e = new Error(generic ? 'Something went wrong. Please check your connection and try again.' : err.message);
    e.code = err?.code;
    throw e;
  }
}
