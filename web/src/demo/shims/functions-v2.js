// firebase-functions/v2 (demo)
export const setGlobalOptions = () => {};
export const logger = {
  info: (...a) => console.info('[functions]', ...a),
  warn: (...a) => console.warn('[functions]', ...a),
  error: (...a) => console.error('[functions]', ...a),
};
