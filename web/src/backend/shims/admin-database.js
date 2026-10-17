// firebase-admin/database → the Firebase client SDK. The backend code in
// functions/src runs in the browser as the signed-in user, so the Realtime
// Database security rules (database.rules.json) decide what it may read/write.
import {
  ref as dbRef, get, set, update, remove, push, runTransaction, query,
  orderByChild, orderByKey, equalTo, startAt, endAt, limitToLast,
} from 'firebase/database';
import { db } from '../../firebase.js';

export const ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };

const join = (a, b) => [a, b].filter(Boolean).join('/');
const node = (path) => (path ? dbRef(db, path) : dbRef(db));

class AdminQuery {
  constructor(path, constraints = []) {
    this.path = path;
    this.constraints = constraints;
  }
  _with(c) { return new AdminQuery(this.path, [...this.constraints, c]); }
  orderByChild(child) { return this._with(orderByChild(child)); }
  orderByKey() { return this._with(orderByKey()); }
  equalTo(v) { return this._with(equalTo(v)); }
  startAt(v) { return this._with(startAt(v)); }
  endAt(v) { return this._with(endAt(v)); }
  limitToLast(n) { return this._with(limitToLast(n)); }
  get() { return get(query(node(this.path), ...this.constraints)); }
}

class AdminRef extends AdminQuery {
  constructor(path) {
    super(path, []);
    this.key = path.split('/').filter(Boolean).pop() || null;
  }
  child(p) { return new AdminRef(join(this.path, p)); }
  push(value) {
    const key = push(node(this.path)).key; // key generated locally, nothing written
    const ref = this.child(key);
    if (value !== undefined) set(node(ref.path), value);
    return ref;
  }
  get() { return get(node(this.path)); }
  set(value) { return set(node(this.path), value); }
  update(values) { return update(node(this.path), values); }
  remove() { return remove(node(this.path)); }
  async transaction(fn) {
    const r = await runTransaction(node(this.path), fn, { applyLocally: false });
    return { committed: r.committed, snapshot: r.snapshot };
  }
}

export const getDatabase = () => ({ ref: (path = '') => new AdminRef(path) });
