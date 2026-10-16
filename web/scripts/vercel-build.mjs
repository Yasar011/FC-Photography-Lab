// Vercel build: the in-browser demo by default; the real Firebase app when the
// project sets FC_MODE=production (plus the VITE_FIREBASE_* environment variables).
import { build } from 'vite';

const production = process.env.FC_MODE === 'production';
console.log(`Building ${production ? 'PRODUCTION (Firebase)' : 'DEMO'} app → web/dist-vercel`);
await build({
  mode: production ? 'production' : 'demo',
  build: { outDir: 'dist-vercel', emptyOutDir: true },
});
