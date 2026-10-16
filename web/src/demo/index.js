// Demo entry — only reachable through the `@demo` alias in `--mode demo`.
import { ensureSeeded } from './seed.js';
import { startSchedules } from './server.js';

export { default as DemoBar } from './DemoBar.jsx';
export { default as DemoLogin } from './DemoLogin.jsx';

export async function demoBootstrap() {
  try {
    await ensureSeeded();
  } catch (err) {
    console.error('[demo] seeding failed', err);
  }
  startSchedules();
}
