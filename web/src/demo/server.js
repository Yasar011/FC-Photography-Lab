// Demo "backend": the real Cloud Functions from functions/src, executed in the
// page against the in-browser database. Same validation, same transactions,
// same status workflow as production.
import './buffer-global.js'; // first: functions code expects Node's global Buffer
import * as fns from '../../../functions/src/index.js';
import { currentUser } from './session.js';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function demoCall(name, data, { as, latency = 180 } = {}) {
  const fn = fns[name];
  if (!fn?.__handler) throw Object.assign(new Error(`Unknown function ${name}`), { name: 'HttpsError', code: 'not-found' });
  const user = as || currentUser();
  const request = {
    auth: user ? { uid: user.uid, token: { email: user.email, email_verified: true, name: user.name } } : null,
    data: clone(data ?? {}),
  };
  if (latency) await wait(latency); // feel like a network round trip
  return clone(await fn.__handler(request));
}

let started = false;
/** Run the scheduled jobs the way Cloud Scheduler would (completion every minute in the demo). */
export function startSchedules() {
  if (started) return;
  started = true;
  const run = () => fns.completeBookings.__schedule().catch((e) => console.error('[demo] completeBookings', e));
  run();
  setInterval(run, 60000);
}
