// nodemailer (demo) — emails are captured in the demo outbox instead of sent.
import { store } from '../store.js';
import { pushId } from '../memdb.js';

function createTransport() {
  return {
    async sendMail({ from, to, subject, html, text }) {
      const id = pushId();
      store.set(`demoOutbox/${id}`, { from, to, subject, html, text, at: Date.now() });
      return { messageId: `demo-${id}` };
    },
  };
}

export default { createTransport };
