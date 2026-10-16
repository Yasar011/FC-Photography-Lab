// firebase-admin/database (demo) — same API surface the functions use.
import { store } from '../store.js';
import { ServerValue, pushId } from '../memdb.js';

export { ServerValue };

const join = (a, b) => [a, b].filter(Boolean).join('/');

class AdminQuery {
  constructor(path, q) {
    this.path = path;
    this.q = q;
  }
  _with(patch) {
    return new AdminQuery(this.path, { ...(this.q || {}), ...patch });
  }
  orderByChild(child) { return this._with({ orderBy: 'child', child }); }
  orderByKey() { return this._with({ orderBy: 'key' }); }
  equalTo(v) { return this._with({ equalTo: v }); }
  startAt(v) { return this._with({ startAt: v }); }
  endAt(v) { return this._with({ endAt: v }); }
  limitToLast(n) { return this._with({ limitToLast: n }); }
  async get() { return store.snapshot(this.path, this.q); }
}

class AdminRef extends AdminQuery {
  constructor(path) {
    super(path, null);
    this.key = path.split('/').filter(Boolean).pop() || null;
  }
  child(p) { return new AdminRef(join(this.path, p)); }
  push(value) {
    const ref = this.child(pushId());
    if (value !== undefined) store.set(ref.path, value);
    return ref;
  }
  async get() { return store.snapshot(this.path); }
  async set(value) { store.set(this.path, value); }
  async update(values) { store.update(this.path, values); }
  async remove() { store.set(this.path, null); }
  async transaction(fn) { return store.transaction(this.path, fn); }
}

export const getDatabase = () => ({ ref: (path = '') => new AdminRef(path) });
