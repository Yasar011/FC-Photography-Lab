// Uploads database.rules.json to the Realtime Database using a service-account
// key (no Firebase CLI login needed). The key stays outside the repo:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/deploy-db-rules.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to the service-account key file.');
const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
const dbUrl = process.env.DATABASE_URL || `https://${sa.project_id}-default-rtdb.firebaseio.com`;
const rules = readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');

const { access_token: token } = await admin.credential.cert(sa).getAccessToken();
const res = await fetch(`${dbUrl}/.settings/rules.json`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: rules,
});
const text = await res.text();
if (!res.ok) {
  console.error(`Rules rejected (HTTP ${res.status}):\n${text}`);
  process.exit(1);
}
console.log(`Rules deployed to ${dbUrl} — ${text}`);
