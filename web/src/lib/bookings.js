import { useMemo } from 'react';
import { orderByChild, equalTo } from 'firebase/database';
import { useLive, dbQuery } from './hooks.js';
import { ACTIVE_STATUSES } from '@shared/constants.js';

/** Live list of a student's own bookings, newest first. */
export function useMyBookings(uid) {
  const q = useMemo(() => (uid ? dbQuery('bookings', orderByChild('studentUid'), equalTo(uid)) : null), [uid]);
  const { value, loading, error } = useLive(q, [q]);
  const items = Object.values(value || {}).sort((a, b) => b.startAt - a.startAt);
  return { items, loading, error };
}

/** Live FC approval requests assigned to the user. */
export function useMyFcApprovals(uid) {
  const q = useMemo(() => (uid ? dbQuery('fcApprovals', orderByChild('fcStudentUid'), equalTo(uid)) : null), [uid]);
  const { value, loading, error } = useLive(q, [q]);
  const items = Object.values(value || {}).sort((a, b) => b.createdAt - a.createdAt);
  return { items, loading, error };
}

export const isUpcoming = (b, now = Date.now()) => ACTIVE_STATUSES.includes(b.status) && b.endAt > now;

/** Hours the student asked to be told about if they free up: { "2026-10-27_h18": { date, hour } }. */
export function useMyWatches(uid) {
  const { value } = useLive(uid ? `slotWatch/${uid}` : null, [uid]);
  return value || {};
}
