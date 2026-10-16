// Singletons shared by the demo "client" and the demo "server".
import { MemoryDB } from './memdb.js';

export const DB_KEY = 'fc-demo-db-v7';
export const FILES_KEY = 'fc-demo-files-v7';
export const store = new MemoryDB(DB_KEY);

// Tiny file store standing in for Cloud Storage (signature PNGs).
export const files = {
  save(path, base64) {
    const all = this._all();
    all[path] = base64;
    try {
      localStorage.setItem(FILES_KEY, JSON.stringify(all));
    } catch (err) {
      console.warn('[demo] could not store file', err);
    }
  },
  load(path) {
    return this._all()[path] ?? null;
  },
  _all() {
    try {
      return JSON.parse(localStorage.getItem(FILES_KEY) || '{}');
    } catch {
      return {};
    }
  },
};

export function resetDemo() {
  try {
    localStorage.removeItem(DB_KEY);
    localStorage.removeItem(FILES_KEY);
    sessionStorage.clear();
  } catch { /* ignore */ }
}
