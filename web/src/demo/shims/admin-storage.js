// firebase-admin/storage (demo) — files kept in localStorage.
import { Buffer } from 'buffer';
import { files } from '../store.js';

export const getStorage = () => ({
  bucket: () => ({
    file: (path) => ({
      async save(buf) {
        files.save(path, Buffer.from(buf).toString('base64'));
      },
      async download() {
        const b64 = files.load(path);
        if (!b64) throw new Error(`No such object: ${path}`);
        return [Buffer.from(b64, 'base64')];
      },
    }),
  }),
});
