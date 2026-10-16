// firebase-functions/params (demo) — values a real deployment reads from .env.
const base = () => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}#`;
};
const DEMO_ENV = {
  MAIN_ADMIN_EMAILS: 'fc.coordinator@nift.ac.in',
  SMTP_USER: 'fc.photolab@nift.ac.in',
  MAIL_FROM: 'FC Photography Lab <fc.photolab@nift.ac.in>',
};

export function defineString(name, opts = {}) {
  return { value: () => (name === 'APP_URL' ? base() : DEMO_ENV[name] ?? opts.default ?? '') };
}

export function defineSecret() {
  return { value: () => 'demo-secret' };
}
