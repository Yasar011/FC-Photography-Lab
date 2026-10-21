// "Notify me if it frees up": a student can watch hours that another booking
// holds (pending or approved). When that booking is cancelled or rejected the
// hours are released, and the Google Sheet emails everyone watching them —
// first come, first served. The Sheet checks the hours really are free before
// sending, so this can't be used to email people at will.
import { onCall } from 'firebase-functions/v2/https';

import { db, fail, getActor } from './core.js';
import { notifySlotFreed } from './mail.js';
import { slotKey, isValidDateStr, bookingWindow, todayIST } from '../shared/calendar.js';
import { withRuleDefaults } from '../shared/defaults.js';

export const MAX_WATCHES = 12;
const watchKey = (date, hour) => `${date}_${slotKey(hour)}`;

/** Start or stop watching some hours of a day: { date, hours: [17, 18], on: true|false }. */
export const watchSlot = onCall(async (request) => {
  const actor = await getActor(request);
  if (!actor.profile?.niftId) fail('failed-precondition', 'Only registered students can get slot alerts.');
  const d = request.data || {};
  const date = String(d.date || '');
  const hours = [...new Set((Array.isArray(d.hours) ? d.hours : []).map(Number))];
  if (!isValidDateStr(date)) fail('invalid-argument', 'Invalid date.');
  if (!hours.length || hours.length > 6 || hours.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) fail('invalid-argument', 'Invalid hours.');

  const mine = (await db.ref(`slotWatch/${actor.uid}`).get()).val() || {};
  const updates = {};
  if (d.on === false) {
    for (const h of hours) updates[`slotWatch/${actor.uid}/${watchKey(date, h)}`] = null;
    await db.ref().update(updates);
    return { ok: true, watching: false };
  }

  const settings = (await db.ref('settings/bookingRules').get()).val();
  const w = bookingWindow(withRuleDefaults(settings), Date.now(), false);
  if (date < todayIST() || date > w.to) fail('invalid-argument', 'You can only watch days you can book.');
  const day = (await db.ref(`bookingSlots/${date}`).get()).val() || {};
  for (const h of hours) {
    const s = day[slotKey(h)];
    if (!s?.bookingId) fail('failed-precondition', 'This hour is free — you can book it now.');
    if (s.uid === actor.uid) fail('failed-precondition', 'This is your own booking.');
  }
  const fresh = hours.filter((h) => !mine[watchKey(date, h)]);
  if (Object.keys(mine).length + fresh.length > MAX_WATCHES) fail('resource-exhausted', `You can watch up to ${MAX_WATCHES} hours at a time.`);
  for (const h of fresh) {
    updates[`slotWatch/${actor.uid}/${watchKey(date, h)}`] = {
      date,
      hour: h,
      email: actor.email,
      name: actor.profile.name || actor.name || '',
      at: Date.now(),
    };
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  return { ok: true, watching: true };
});

/** Hours were released on this date: let the Sheet tell anyone watching. Never throws. */
export function slotsReleased(date) {
  return notifySlotFreed(date).catch(() => {});
}
