import { useMemo } from 'react';
import { orderByKey, startAt, endAt } from 'firebase/database';

import { useLive, dbQuery } from '../lib/hooks.js';
import { classifySlot, slotKey } from '@shared/calendar.js';

/** Live slot occupancy for a date range (real-time listener). */
export function useSlotRange(from, to) {
  const q = useMemo(() => (from && to ? dbQuery('bookingSlots', orderByKey(), startAt(from), endAt(to)) : null), [from, to]);
  const { value, loading, error } = useLive(q, [q]);
  return { slots: value || {}, loading, error };
}

/** Classify every hour of a date for the given viewer (same rules as the backend). */
export function daySlots({ date, rules, settings, slots, nowMs, viewerUid, staffView, ignoreWindow }) {
  const out = [];
  const holiday = settings?.holidays?.[date] || null;
  const overrides = settings?.availabilityOverrides?.[date] || {};
  const daySlotMap = slots?.[date] || {};
  for (let h = rules.gridStartHour; h < rules.gridEndHour; h++) {
    out.push(
      classifySlot({
        date,
        hour: h,
        rules,
        holiday,
        override: overrides[slotKey(h)] || null,
        slot: daySlotMap[slotKey(h)] || null,
        nowMs,
        viewerUid,
        staffView,
        ignoreWindow,
      }),
    );
  }
  return out;
}
