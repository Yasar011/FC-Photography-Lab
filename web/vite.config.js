import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The calendar/booking rules live in functions/shared and are imported by both
// the backend and this UI, so the two can never disagree.
const shared = fileURLToPath(new URL('../functions/shared', import.meta.url));
const shim = (f) => fileURLToPath(new URL(`./src/demo/shims/${f}`, import.meta.url));

// `--mode demo` swaps the Firebase SDKs for in-browser shims and runs the real
// Cloud Functions code (functions/src) inside the page. No Firebase project needed.
const DEMO_ALIASES = [
  [/^firebase\/app$/, 'client-app.js'],
  [/^firebase\/auth$/, 'client-auth.js'],
  [/^firebase\/database$/, 'client-database.js'],
  [/^firebase\/functions$/, 'client-functions.js'],
  [/^firebase-admin\/app$/, 'admin-app.js'],
  [/^firebase-admin\/database$/, 'admin-database.js'],
  [/^firebase-admin\/storage$/, 'admin-storage.js'],
  [/^firebase-admin\/auth$/, 'admin-auth.js'],
  [/^firebase-functions\/v2$/, 'functions-v2.js'],
  [/^firebase-functions\/v2\/https$/, 'functions-https.js'],
  [/^firebase-functions\/v2\/scheduler$/, 'functions-scheduler.js'],
  [/^firebase-functions\/params$/, 'functions-params.js'],
  [/^nodemailer$/, 'nodemailer.js'],
  [/^node:crypto$/, 'node-crypto.js'],
].map(([find, file]) => ({ find, replacement: shim(file) }));

// Production on the free Spark plan: the real Firebase SDK, but the backend
// code (functions/src) runs in the browser. Set VITE_BACKEND=functions to use
// deployed Cloud Functions instead.
const backendShim = (f) => fileURLToPath(new URL(`./src/backend/shims/${f}`, import.meta.url));
const CLIENT_BACKEND_ALIASES = [
  [/^firebase-admin\/app$/, shim('admin-app.js')],
  [/^firebase-admin\/database$/, backendShim('admin-database.js')],
  [/^firebase-admin\/storage$/, backendShim('admin-storage.js')],
  [/^firebase-admin\/auth$/, backendShim('admin-auth.js')],
  [/^firebase-functions\/v2$/, shim('functions-v2.js')],
  [/^firebase-functions\/v2\/https$/, shim('functions-https.js')],
  [/^firebase-functions\/v2\/scheduler$/, shim('functions-scheduler.js')],
  [/^firebase-functions\/params$/, backendShim('functions-params.js')],
  [/^nodemailer$/, backendShim('nodemailer.js')],
  [/^node:crypto$/, shim('node-crypto.js')],
].map(([find, replacement]) => ({ find, replacement }));

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const clientBackend = !demo && loadEnv(mode, process.cwd(), 'VITE_').VITE_BACKEND !== 'functions';
  return {
    plugins: [react()],
    base: demo ? './' : '/',
    resolve: {
      alias: [
        { find: '@shared', replacement: shared },
        { find: /^@demo$/, replacement: fileURLToPath(new URL(`./src/demo/${demo ? 'index.js' : 'stub.js'}`, import.meta.url)) },
        { find: /^@backend$/, replacement: fileURLToPath(new URL(`./src/backend/${clientBackend ? 'index.js' : 'stub.js'}`, import.meta.url)) },
        ...(demo ? DEMO_ALIASES : []),
        ...(clientBackend ? CLIENT_BACKEND_ALIASES : []),
      ],
    },
    server: { port: demo ? 5174 : 5173, fs: { allow: ['..'] } },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      rollupOptions: demo
        ? {}
        : {
            output: {
              manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/database', 'firebase/functions'] },
            },
          },
    },
  };
});
