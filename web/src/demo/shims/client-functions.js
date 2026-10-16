// firebase/functions (demo) — callables run the real Cloud Functions code in-page.
import { demoCall } from '../server.js';

export const getFunctions = () => ({});
export const connectFunctionsEmulator = () => {};

export function httpsCallable(functions, name) {
  return async (data) => {
    try {
      return { data: await demoCall(name, data) };
    } catch (err) {
      if (err?.name === 'HttpsError') {
        const e = new Error(err.message);
        e.code = `functions/${err.code}`;
        throw e;
      }
      console.error(`[demo] ${name} failed`, err);
      const e = new Error('internal');
      e.code = 'functions/internal';
      throw e;
    }
  };
}
