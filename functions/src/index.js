// FC Photography Lab — Cloud Functions entry point.
// Every write to the database goes through these functions; database.rules.json
// denies all direct client writes.
// Global options (region etc.) are set in core.js, which every module imports
// first — ESM hoists these re-exports above any code in this file.
export { syncAccount, registerStudent, updateMyProfile } from './accounts.js';
export {
  createBooking,
  cancelBooking,
  adminBookingDecision,
  getSignature,
  lookupStudent,
  searchStudents,
  recordEquipment,
  resendDecisionEmail,
} from './bookings.js';
export {
  respondFcApproval,
  specialApprovalStep,
  resolveFacultyConcern,
  getFacultyNotice,
  facultyRespond,
} from './approvals.js';
export {
  setSlotOverride,
  removeSlotOverride,
  setHoliday,
  removeHoliday,
  updateStudent,
  setAdminRole,
  saveSettings,
  runSemesterProgression,
} from './adminOps.js';
export { academicScheduler, completeBookings } from './academicJob.js';
export { saveMySignature, getMySignature, getBookingSignatures } from './signatures.js';
