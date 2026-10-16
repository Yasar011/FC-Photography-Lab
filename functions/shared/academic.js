// Automatic semester progression (pure logic — the scheduler in functions/
// applies it). Academic cycle: Aug–Dec odd, Jan–May even, Jun–Jul break.

import { ACCOUNT_STATUS, MAX_SEMESTER } from './constants.js';
import { DEFAULT_ACADEMIC_CALENDAR } from './defaults.js';
import { diffDays } from './calendar.js';

export const PROGRESSION_EVENTS = {
  ODD_TO_EVEN: 'oddToEven',
  GRADUATION: 'graduation',
  EVEN_TO_ODD: 'evenToOdd',
};

export const PROGRESSION_LABELS = {
  oddToEven: 'Odd → Even semester (January)',
  graduation: 'Final semester → Graduated (after May)',
  evenToOdd: 'Even → Odd semester (August)',
};

const EVENT_DATE_FIELD = {
  oddToEven: 'oddToEvenDate',
  graduation: 'graduationDate',
  evenToOdd: 'evenToOddDate',
};

export const runKey = (year, event) => `${year}-${event}`;

/** Events whose date has arrived (within the catch-up window) and have not run yet. */
export function dueProgressionEvents(today, calendar, lastRuns = {}) {
  const cal = { ...DEFAULT_ACADEMIC_CALENDAR, ...(calendar || {}) };
  if (!cal.autoProgression) return [];
  const year = Number(today.slice(0, 4));
  const due = [];
  for (const event of Object.values(PROGRESSION_EVENTS)) {
    const eventDate = `${year}-${cal[EVENT_DATE_FIELD[event]]}`;
    const age = diffDays(eventDate, today);
    if (age >= 0 && age <= Number(cal.catchUpDays ?? 14) && !lastRuns[runKey(year, event)]) {
      due.push({ event, year, key: runKey(year, event), eventDate });
    }
  }
  return due;
}

/**
 * What a student's record becomes after an event. Returns null if unchanged.
 * Only ACTIVE students progress; parity checks make every event idempotent.
 */
export function progressStudent(student, event) {
  if (!student || student.status !== ACCOUNT_STATUS.ACTIVE) return null;
  const sem = Number(student.semester);
  const max = MAX_SEMESTER[student.department];
  if (!max || !Number.isInteger(sem)) return null;

  if (event === PROGRESSION_EVENTS.ODD_TO_EVEN) {
    if (sem % 2 === 1 && sem < max) return { semester: sem + 1 };
    return null;
  }
  if (event === PROGRESSION_EVENTS.EVEN_TO_ODD) {
    if (sem % 2 === 0 && sem < max) return { semester: sem + 1 };
    return null;
  }
  if (event === PROGRESSION_EVENTS.GRADUATION) {
    if (sem >= max) return { status: ACCOUNT_STATUS.GRADUATED, bookingAccess: false };
    return null;
  }
  return null;
}
