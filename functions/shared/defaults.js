// Default configuration written to /settings on first run. Everything here is
// editable by the Main Admin from the Settings screen — nothing is hard-coded
// into the booking flow.

export const DEFAULT_BOOKING_RULES = {
  // Calendar grid (24h clock, IST). Slots are one hour long.
  gridStartHour: 9,
  gridEndHour: 24,

  // Weekday CLS classroom hours — blocked unless Staff Admin opens a slot.
  classDays: [1, 2, 3, 4, 5], // 0 = Sunday … 6 = Saturday
  classStartHour: 9,
  classEndHour: 17,
  classLabel: 'CLS CLASS',

  // Regular student booking window on class days.
  regularStartHour: 17,
  regularEndHour: 22,

  // After regularEndHour → special approval workflow.
  afterHoursEnabled: true,
  // Weekend → special approval workflow.
  weekendDays: [0, 6],
  weekendBookingEnabled: true,
  weekendStartHour: 9,
  // When Staff Admin opens a public holiday, bookings start from this hour.
  holidayOpenStartHour: 9,

  bookingWindowDays: 7, // students: today + next 6 days
  staffBookingWindowDays: 30,
  maxDurationHours: 3, // other students
  fcMaxDurationHours: 4, // FC / FC-IDM students

  firstYearMaxSemester: 2,
  seniorMinSemester: 3,
  firstYearMessage:
    'You cannot independently book/use the FC Photography Lab as a first-year student. You may use the lab with a senior student.',

  otherDeptRequiresFcStudent: true,
  fcIdmRequiresFcApproval: false,
  fcApproverTypes: ['FC_STUDENT'],

  otherDeptNoticeEnabled: true,
  otherDeptNotice:
    'Students from other departments must bring their department camera/equipment where required.',

  specialHoursMessage:
    'This booking is outside regular lab hours and requires additional approval.',

  facultyEmailRequired: true,
  facultyEmailDomains: ['nift.ac.in'],

  studentCanCancel: true,
  // A student who cancels their own booking can't book again for this many days (0 = off).
  cancelCooldownDays: 4,


};

export const DEFAULT_EQUIPMENT = {
  photoLab: { name: 'Photography Lab', enabled: true, order: 1 },
  camera: { name: 'Camera', enabled: true, order: 2, otherDeptBringOwn: true },
  lights: { name: 'Lights', enabled: true, order: 3 },
  rgbLight: { name: 'RGB Light', enabled: true, order: 4 },
  greenRoom: { name: 'Green Room', enabled: true, order: 5 },
  trigger: { name: 'Trigger', enabled: true, order: 6 },
  clsRoom: {
    name: 'CLS Class Room',
    enabled: true,
    order: 7,
    requiresReason: true,
    reasonLabel: 'Why do you need the CLS Class Room?',
  },
};

export const DEFAULT_QUESTIONS = {
  q_team: {
    label: 'Number of people in the lab',
    type: 'number',
    required: true,
    enabled: true,
    order: 1,
    defaultValue: 1,
  },
  q_models: {
    label: 'Other students / models attending (optional)',
    type: 'textarea',
    required: false,
    enabled: true,
    order: 2,
  },
};

export const DEFAULT_DECLARATION = {
  title: 'Declaration & Undertaking',
  text:
    'I hereby declare that the information provided in this booking is true and correct. ' +
    'I will use the FC Photography Lab and its equipment responsibly, follow all lab rules and ' +
    'instructions of the lab staff, and leave the lab clean and in order. I accept responsibility ' +
    'for any loss of or damage to equipment caused during my booking, and I will report any ' +
    'damage or malfunction to the FC staff immediately.',
  // One tick keeps booking quick; Main Admin can add more confirmations.
  confirmations: {
    c_agree: {
      label: 'I have read and agree to the declaration and the lab rules.',
      required: true,
      enabled: true,
      order: 1,
    },
  },
};

export const DEFAULT_INSTRUCTIONS = {
  text:
    '• Every booking is confirmed only after FC-CC approval. Bookings open for the next 7 days.\n' +
    '• Maximum 4 hours per booking for FC students, 3 hours for other students.\n' +
    '• Weekday 9 AM–5 PM is reserved for CLS classes unless opened by FC staff.\n' +
    '• Bookings after 10 PM, on weekends or on holidays need special approval.\n' +
    '• If you cancel a booking, you cannot make a new booking for 4 days.\n' +
    '• Carry your NIFT ID card. Report any equipment issue to the FC staff immediately.',
};

export const DEFAULT_ACADEMIC_CALENDAR = {
  autoProgression: true,
  // MM-DD dates (IST). Odd = Aug–Dec, Even = Jan–May, Jun–Jul = break.
  oddToEvenDate: '01-01', // Sem 1→2, 3→4, 5→6, 7→8
  graduationDate: '06-01', // final semester (8, or 4 for MFM) → Graduated
  evenToOddDate: '08-01', // Sem 2→3, 4→5, 6→7
  catchUpDays: 14, // a missed run (e.g. outage) is still applied within this window
};

export const DEFAULT_SETTINGS = {
  bookingRules: DEFAULT_BOOKING_RULES,
  questions: DEFAULT_QUESTIONS,
  declaration: DEFAULT_DECLARATION,
  instructions: DEFAULT_INSTRUCTIONS,
  academicCalendar: DEFAULT_ACADEMIC_CALENDAR,
};

/** Maximum booking length for a student type (FC students get longer). */
export function maxHoursFor(rules, studentType) {
  const r = withRuleDefaults(rules);
  return studentType === 'FC_STUDENT' || studentType === 'FC_IDM_STUDENT' ? r.fcMaxDurationHours : r.maxDurationHours;
}

/** Active "cancelled recently" block on a student profile, or null. */
export function activeBookingBlock(profile, nowMs = Date.now()) {
  const block = profile?.bookingBlock;
  return block?.until && block.until > nowMs ? block : null;
}

export function withRuleDefaults(rules) {
  return { ...DEFAULT_BOOKING_RULES, ...(rules || {}) };
}

export function sortedEntries(obj) {
  return Object.entries(obj || {})
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
