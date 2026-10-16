// firebase/database (demo) — live listeners over the shared in-browser database.
import { store } from '../store.js';

export const getDatabase = () => ({});
export const connectDatabaseEmulator = () => {};

export const ref = (db, path = '') => ({ path: String(path), q: null });
export function query(r, ...constraints) {
  return { path: r.path, q: Object.assign({}, r.q, ...constraints) };
}
export const orderByChild = (child) => ({ orderBy: 'child', child });
export const orderByKey = () => ({ orderBy: 'key' });
export const equalTo = (v) => ({ equalTo: v });
export const startAt = (v) => ({ startAt: v });
export const endAt = (v) => ({ endAt: v });
export const limitToLast = (n) => ({ limitToLast: n });

export function onValue(target, cb) {
  return store.listen(target.path, target.q, cb);
}
export async function get(target) {
  return store.snapshot(target.path, target.q);
}
