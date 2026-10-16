// firebase-functions/v2/scheduler (demo) — the demo runtime triggers these.
export function onSchedule(opts, handler) {
  return { __schedule: handler, __opts: opts };
}
