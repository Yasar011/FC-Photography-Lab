// firebase-functions/params → build-time settings (Vite env) for the in-browser backend.
const env = import.meta.env;
const VALUES = {
  MAIN_ADMIN_EMAILS: env.VITE_MAIN_ADMIN_EMAILS || 'fc.jodhpur@nift.ac.in',
  SHEETS_WEBHOOK_URL: env.VITE_SHEETS_WEBHOOK_URL || '',
};

export function defineString(name, opts = {}) {
  return {
    value: () => {
      if (name === 'APP_URL') return typeof window === 'undefined' ? env.VITE_APP_URL || '' : window.location.origin;
      return VALUES[name] ?? opts.default ?? '';
    },
  };
}

// No secrets in the browser: the Google Sheet checks the user's Firebase sign-in instead.
export function defineSecret() {
  return { value: () => '' };
}
