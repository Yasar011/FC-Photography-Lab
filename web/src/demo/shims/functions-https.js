// firebase-functions/v2/https (demo) — callables become plain handlers.
export class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
  }
}

export function onCall(optsOrHandler, maybeHandler) {
  const handler = typeof optsOrHandler === 'function' ? optsOrHandler : maybeHandler;
  return { __handler: handler };
}
