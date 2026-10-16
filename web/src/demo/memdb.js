// A small in-browser stand-in for the Firebase Realtime Database used by DEMO
// mode. It supports the subset of the API this app uses (get/set/update/
// remove/push/transaction, ordered queries, live listeners) and persists to
// localStorage so several browser tabs share one database in real time.

const SV_TIMESTAMP = { '.sv': 'timestamp' };
export const ServerValue = { TIMESTAMP: SV_TIMESTAMP };

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const split = (path) => String(path || '').split('/').filter(Boolean);

// RTDB semantics: nulls delete, empty objects vanish, server values resolve.
function clean(value, now) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((v) => clean(v, now) ?? null);
  if (typeof value === 'object') {
    if (value['.sv'] === 'timestamp') return now;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = clean(v, now);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  return value;
}

// Firebase-style push IDs (chronologically sortable).
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let lastPushTime = 0;
const lastRand = [];
export function pushId() {
  let now = Date.now();
  const dup = now === lastPushTime;
  lastPushTime = now;
  const time = new Array(8);
  for (let i = 7; i >= 0; i--) {
    time[i] = PUSH_CHARS.charAt(now % 64);
    now = Math.floor(now / 64);
  }
  let id = time.join('');
  if (!dup) for (let i = 0; i < 12; i++) lastRand[i] = Math.floor(Math.random() * 64);
  else {
    let i = 11;
    for (; i >= 0 && lastRand[i] === 63; i--) lastRand[i] = 0;
    lastRand[i] += 1;
  }
  for (let i = 0; i < 12; i++) id += PUSH_CHARS.charAt(lastRand[i]);
  return id;
}

// ---- Snapshots ---------------------------------------------------------------
export class Snapshot {
  constructor(key, value, order = null) {
    this.key = key;
    this._v = value === undefined ? null : value;
    this._order = order;
  }
  val() {
    return clone(this._v) ?? null;
  }
  exists() {
    return this._v !== null && this._v !== undefined;
  }
  child(path) {
    let v = this._v;
    const parts = split(path);
    for (const p of parts) v = v && typeof v === 'object' ? v[p] : undefined;
    return new Snapshot(parts[parts.length - 1] || this.key, v);
  }
  forEach(cb) {
    if (!this._v || typeof this._v !== 'object') return false;
    const keys = this._order || Object.keys(this._v).sort(compareKeys);
    for (const k of keys) if (cb(new Snapshot(k, this._v[k])) === true) return true;
    return false;
  }
}

function compareKeys(a, b) {
  const na = /^-?\d+$/.test(a) ? Number(a) : null;
  const nb = /^-?\d+$/.test(b) ? Number(b) : null;
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// RTDB ordering: null < false < true < numbers < strings < objects
const typeRank = (v) => (v === null || v === undefined ? 0 : v === false ? 1 : v === true ? 2 : typeof v === 'number' ? 3 : typeof v === 'string' ? 4 : 5);
function compareValues(a, b) {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 3 || ra === 4) return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

/** Apply orderBy / equalTo / startAt / endAt / limitToLast to an object. */
export function runQuery(obj, q) {
  if (!obj || typeof obj !== 'object') return { value: null, order: [] };
  const sortVal = (k) => {
    if (q.orderBy === 'key') return k;
    if (q.orderBy === 'child') {
      let v = obj[k];
      for (const p of split(q.child)) v = v && typeof v === 'object' ? v[p] : undefined;
      return v ?? null;
    }
    return k;
  };
  let keys = Object.keys(obj).sort((a, b) => compareValues(sortVal(a), sortVal(b)) || compareKeys(a, b));
  if ('equalTo' in q) keys = keys.filter((k) => sortVal(k) === q.equalTo);
  if ('startAt' in q) keys = keys.filter((k) => compareValues(sortVal(k), q.startAt) >= 0);
  if ('endAt' in q) keys = keys.filter((k) => compareValues(sortVal(k), q.endAt) <= 0);
  if (q.limitToLast) keys = keys.slice(-q.limitToLast);
  if (q.limitToFirst) keys = keys.slice(0, q.limitToFirst);
  if (!keys.length) return { value: null, order: [] };
  const value = {};
  for (const k of keys) value[k] = obj[k];
  return { value, order: keys };
}

// ---- Database ----------------------------------------------------------------
export class MemoryDB {
  constructor(storageKey) {
    this.storageKey = storageKey;
    this.root = this._load();
    this.listeners = new Set();
    this._pending = false;
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === this.storageKey) {
          this.root = this._load();
          this._notify();
        }
      });
    }
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || '{}') || {};
    } catch {
      return {};
    }
  }

  _persist() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.root));
    } catch (err) {
      console.warn('[demo] could not persist database', err);
    }
  }

  getRaw(path) {
    let v = this.root;
    for (const p of split(path)) {
      if (!v || typeof v !== 'object') return undefined;
      v = v[p];
    }
    return v;
  }

  _setRaw(path, value) {
    const parts = split(path);
    if (!parts.length) {
      this.root = value && typeof value === 'object' ? value : {};
      return;
    }
    const stack = [this.root];
    let node = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
      node = node[parts[i]];
      stack.push(node);
    }
    const last = parts[parts.length - 1];
    if (value === undefined) delete node[last];
    else node[last] = value;
    // prune empty parents
    for (let i = parts.length - 2; i >= 0; i--) {
      const parent = stack[i];
      const child = parent[parts[i]];
      if (child && typeof child === 'object' && !Array.isArray(child) && !Object.keys(child).length) delete parent[parts[i]];
      else break;
    }
  }

  /** Run a write against the freshest copy (other tabs may have written). */
  write(fn) {
    this.root = this._load();
    const result = fn();
    this._persist();
    this._notify();
    return result;
  }

  set(path, value) {
    this.write(() => this._setRaw(path, clean(clone(value), Date.now())));
  }

  update(path, values) {
    this.write(() => {
      const now = Date.now();
      for (const [k, v] of Object.entries(values || {})) {
        this._setRaw(`${path}/${k}`, clean(clone(v), now));
      }
    });
  }

  transaction(path, fn) {
    return this.write(() => {
      const current = clone(this.getRaw(path)) ?? null;
      const next = fn(current);
      if (next === undefined) return { committed: false, snapshot: new Snapshot(split(path).pop(), current) };
      this._setRaw(path, clean(clone(next), Date.now()));
      return { committed: true, snapshot: new Snapshot(split(path).pop(), clone(this.getRaw(path))) };
    });
  }

  snapshot(path, query = null) {
    const key = split(path).pop() || null;
    const raw = this.getRaw(path);
    if (!query) return new Snapshot(key, clone(raw));
    const { value, order } = runQuery(raw, query);
    return new Snapshot(key, clone(value), order);
  }

  listen(path, query, cb) {
    const l = { path, query, cb, last: undefined };
    this.listeners.add(l);
    setTimeout(() => this._fire(l), 0);
    return () => this.listeners.delete(l);
  }

  _fire(l) {
    if (!this.listeners.has(l)) return;
    const snap = this.snapshot(l.path, l.query);
    const sig = JSON.stringify([snap._v, snap._order]);
    if (sig === l.last) return;
    l.last = sig;
    try {
      l.cb(snap);
    } catch (err) {
      console.error(err);
    }
  }

  _notify() {
    if (this._pending) return;
    this._pending = true;
    setTimeout(() => {
      this._pending = false;
      for (const l of [...this.listeners]) this._fire(l);
    }, 0);
  }

  reset() {
    this.root = {};
    this._persist();
    this._notify();
  }
}
