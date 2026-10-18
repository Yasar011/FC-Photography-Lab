// Shared constants used by BOTH Cloud Functions (authoritative) and the web UI.
// Any rule that matters is re-checked on the backend; the UI uses this module
// only to give students the same answer before they submit.

export const APP_NAME = 'FC Photography Lab';
export const INSTITUTE = 'NIFT Jodhpur';
export const TIMEZONE = 'Asia/Kolkata';
export const IST_OFFSET_MINUTES = 330; // IST has no daylight saving

// Only Google accounts on these domains may use the system.
// NOTE: database.rules.json contains the same domain as a regex — keep in sync.
export const ALLOWED_EMAIL_DOMAINS = ['nift.ac.in'];

export const DEPARTMENTS = ['AD', 'BFT', 'TD', 'FC', 'FD', 'MFM'];
export const DEPARTMENT_NAMES = {
  AD: 'Accessory Design',
  BFT: 'Fashion Technology',
  TD: 'Textile Design',
  FC: 'Fashion Communication',
  FD: 'Fashion Design',
  MFM: 'Fashion Management (MFM)',
};
export const MAX_SEMESTER = { AD: 8, BFT: 8, TD: 8, FC: 8, FD: 8, MFM: 4 };

export const STUDENT_TYPES = {
  FC: 'FC_STUDENT',
  FC_IDM: 'FC_IDM_STUDENT',
  OTHER: 'OTHER_DEPT_STUDENT',
};
export const STUDENT_TYPE_LABELS = {
  FC_STUDENT: 'FC Student',
  FC_IDM_STUDENT: 'FC-IDM Student',
  OTHER_DEPT_STUDENT: 'Other Department Student',
};

export const ACCOUNT_STATUS = {
  ACTIVE: 'ACTIVE',
  GRADUATED: 'GRADUATED',
  DISABLED: 'DISABLED',
};
export const ACCOUNT_STATUS_LABELS = {
  ACTIVE: 'Active',
  GRADUATED: 'Graduated',
  DISABLED: 'Disabled',
};

export const ROLES = { MAIN: 'main', STAFF: 'staff', FCCC: 'fccc' };
/** Every booking needs the FC-CC's approval — only these roles can give it. */
export const APPROVER_ROLES = ['fccc', 'main'];
export const ROLE_LABELS = {
  main: 'Main Admin',
  staff: 'Staff Admin',
  fccc: 'FC-CC Admin',
};

// ---- Booking statuses ------------------------------------------------------
export const STATUS = {
  SUBMITTED: 'SUBMITTED',
  PENDING_FC_APPROVAL: 'PENDING_FC_APPROVAL',
  FC_APPROVED: 'FC_APPROVED',
  PENDING_SPECIAL_APPROVAL: 'PENDING_SPECIAL_APPROVAL',
  PENDING_FCCC_APPROVAL: 'PENDING_FCCC_APPROVAL',
  FACULTY_CONCERN: 'FACULTY_CONCERN',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED_BY_STUDENT: 'CANCELLED_BY_STUDENT',
  CANCELLED_BY_ADMIN: 'CANCELLED_BY_ADMIN',
  COMPLETED: 'COMPLETED',
};

export const STATUS_META = {
  SUBMITTED: { label: 'Booking Submitted', tone: 'yellow' },
  PENDING_FC_APPROVAL: { label: 'Pending FC Student Approval', tone: 'orange' },
  FC_APPROVED: { label: 'FC Student Approved', tone: 'yellow' },
  PENDING_SPECIAL_APPROVAL: { label: 'Pending Special Approval', tone: 'orange' },
  PENDING_FCCC_APPROVAL: { label: 'Pending FC-CC Approval', tone: 'orange' },
  FACULTY_CONCERN: { label: 'Faculty Concern', tone: 'orange' },
  APPROVED: { label: 'Approved', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
  CANCELLED_BY_STUDENT: { label: 'Cancelled by Student', tone: 'black' },
  CANCELLED_BY_ADMIN: { label: 'Cancelled by Admin', tone: 'black' },
  COMPLETED: { label: 'Completed', tone: 'blue' },
};

// Statuses that hold calendar slots. One slot = one active booking.
export const ACTIVE_STATUSES = [
  STATUS.SUBMITTED,
  STATUS.PENDING_FC_APPROVAL,
  STATUS.FC_APPROVED,
  STATUS.PENDING_SPECIAL_APPROVAL,
  STATUS.PENDING_FCCC_APPROVAL,
  STATUS.FACULTY_CONCERN,
  STATUS.APPROVED,
];
export const PENDING_STATUSES = [
  STATUS.SUBMITTED,
  STATUS.PENDING_FC_APPROVAL,
  STATUS.FC_APPROVED,
  STATUS.PENDING_SPECIAL_APPROVAL,
  STATUS.PENDING_FCCC_APPROVAL,
  STATUS.FACULTY_CONCERN,
];
// Statuses that keep the slot marked in the calendar (released otherwise).
export const SLOT_HOLDING_STATUSES = [...ACTIVE_STATUSES, STATUS.COMPLETED];

// ---- Special approval workflow --------------------------------------------
// Out-of-hours (after 10 PM / weekend / holiday) booking — a paper form:
//   FC Lab Assistant prints & issues it (system step)
//   → [other departments only] Dept CC (e.g. FD CC) or subject faculty signs (paper)
//   → Director's PA (paper) → Director signs (paper)
//   → FC-CC approves & signs digitally in the portal (system step)
//   → student gives the signed form to the Admin Guard.
// `system` steps are recorded in the portal; `paper` steps happen on the form
// and are verified by the FC-CC at final approval. Only `signs` steps put a
// signature on the form — the FC Lab Assistant and Director's PA just pass it on.
export const SPECIAL_STEPS = [
  {
    key: 'fcAssistant',
    label: 'FC Lab Assistant',
    done: 'Form printed & issued to student',
    todo: 'Collect the printed form from the FC Lab Assistant',
    roles: ['staff', 'fccc', 'main'],
    system: true,
    mediator: true,
  },
  {
    key: 'deptCc',
    label: 'Dept CC / Subject Faculty',
    done: 'Signed by the Dept CC / subject faculty',
    todo: 'Get the form signed by your department CC (e.g. FD CC) or subject faculty',
    paper: true,
    otherDeptOnly: true,
    signs: true,
  },
  {
    key: 'directorPA',
    label: "Director's PA",
    done: "Forwarded to the Director by the Director's PA",
    todo: "Hand the form to the Director's PA (forwards it to the Director)",
    paper: true,
    mediator: true,
  },
  {
    key: 'director',
    label: 'Director',
    done: 'Signed by the Director',
    todo: "Get the Director's signature",
    paper: true,
    signs: true,
  },
  {
    key: 'final',
    label: 'FC-CC',
    done: 'Approved & digitally signed by FC-CC',
    todo: 'Return the form to the FC-CC — approval & digital signature in the portal',
    roles: ['fccc', 'main'],
    system: true,
    signs: true,
  },
];

export const ADMIN_GUARD_NOTE = 'After the Director and FC-CC have signed, please give this form to the Admin Guard.';

/** FC and FC-IDM students skip the Dept CC / faculty signature. */
export const isFcType = (studentType) => studentType === 'FC_STUDENT' || studentType === 'FC_IDM_STUDENT';

/** Special-approval steps that apply to this booking's student. */
export function specialStepsFor(studentType) {
  return SPECIAL_STEPS.filter((s) => !s.otherDeptOnly || !isFcType(studentType));
}

export function specialInstructionsFor(studentType) {
  return [...specialStepsFor(studentType).map((s, i) => `${i + 1}. ${s.todo}.`), ADMIN_GUARD_NOTE];
}

export const FC_APPROVAL_STATE = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

// ---- Helpers ---------------------------------------------------------------
export const NIFT_ID_PATTERN = /^[A-Z0-9][A-Z0-9/-]{2,29}$/;

export function normalizeNiftId(id) {
  return String(id || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidNiftId(id) {
  return NIFT_ID_PATTERN.test(normalizeNiftId(id));
}

// RTDB keys cannot contain "/", so slashes become "_". Underscores are not
// allowed in NIFT IDs (see NIFT_ID_PATTERN), so this mapping is reversible.
export function niftKey(id) {
  return normalizeNiftId(id).replace(/\//g, '_');
}

export function emailKey(email) {
  return String(email || '').trim().toLowerCase().replace(/[.#$[\]/]/g, ',');
}

export function isAllowedEmail(email, domains = ALLOWED_EMAIL_DOMAINS) {
  const e = String(email || '').trim().toLowerCase();
  return domains.some((d) => e.endsWith('@' + d.toLowerCase()));
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function defaultStudentType(department) {
  return department === 'FC' ? STUDENT_TYPES.FC : STUDENT_TYPES.OTHER;
}

export function isValidSemester(department, semester) {
  const max = MAX_SEMESTER[department];
  const s = Number(semester);
  return Boolean(max) && Number.isInteger(s) && s >= 1 && s <= max;
}

export function isPhone(phone) {
  return /^[+]?[0-9][0-9\s-]{8,15}$/.test(String(phone || '').trim());
}

// ---- Digital signatures (text stamps — no images are stored) ----------------
export const SIGN_ORG = 'FPL-NJ'; // FC Photography Lab · NIFT Jodhpur

/** Short verification code for a signature (same input → same code). */
export function signCode(...parts) {
  let h = 0x811c9dc5; // FNV-1a
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).toUpperCase().padStart(8, '0');
}

/** A digital signature record: who, as what, when, and its code. */
export function digitalSignature({ name, id = null, role, at, ref }) {
  return { digital: true, name, id, role, at, code: `${SIGN_ORG}-${signCode(ref, name, id, role, at)}` };
}

// ---- People using the lab (special bookings) --------------------------------
/** One line per person: "Name · Department · Hostel, Room". */
export function participantLines(b) {
  return (b?.participants || []).map((p, i) => `${i + 1}. ${p.name} · ${p.department} · ${p.hostel}, Room ${p.room}`);
}
