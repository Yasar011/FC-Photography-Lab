// Email content for every booking event (official, plain).
import { appLink, bookingRows } from './mail.js';
import { formatDateTime } from '../shared/calendar.js';
import { specialStepsFor, specialInstructionsFor, ADMIN_GUARD_NOTE, STATUS, participantLines } from '../shared/constants.js';

const bookingLink = (b) => ({ label: 'View booking', url: appLink(`/bookings/${b.id}`) });

const fcRows = (b) =>
  b.fcStudent ? [['FC Student Involved', `${b.fcStudent.name} (${b.fcStudent.niftId})`]] : [];
/** Special bookings: "People using the lab (N)" + one row per person. */
const peopleRows = (b) => {
  const lines = participantLines(b);
  return lines.length ? [[`People using the lab (${lines.length})`, lines.join('\n')]] : [];
};

const facultyRows = (b) =>
  b.faculty?.email ? [['Subject / Faculty', `${b.faculty.name} <${b.faculty.email}>`]] : [];


export function submittedEmail(b) {
  return {
    type: 'booking_submitted',
    to: b.email,
    subject: `FC Photography Lab Booking Submitted – ${b.id}`,
    bookingId: b.id,
    trigger: 'booking.create',
    content: {
      heading: 'Your booking has been submitted',
      intro: [
        b.bookedByStaff
          ? `This booking was created on your behalf by FC Staff (${b.createdBy?.name}).`
          : b.status === STATUS.PENDING_FCCC_APPROVAL
            ? 'Your booking has been sent to the FC-CC for approval. It is confirmed only after the FC-CC approves — you will get an email.'
            : 'Your FC Photography Lab booking request has been recorded.',
      ],
      rows: bookingRows(b),
      extraRows: [...fcRows(b), ...facultyRows(b)],
      action: bookingLink(b),
    },
  };
}

export function fcccApprovalNeededEmail(b, to) {
  return {
    type: 'fccc_approval_needed',
    to,
    subject: `FC Photography Lab – Approval Needed – ${b.id}`,
    bookingId: b.id,
    trigger: 'booking.fcccApproval',
    content: {
      heading: 'A booking is waiting for your approval',
      intro: [`${b.studentName} (${b.niftId}) has booked the Photography Lab. It is confirmed only after your approval.`],
      rows: bookingRows(b),
      extraRows: [...fcRows(b), ...facultyRows(b)],
      action: { label: 'Review & approve', url: appLink(`/bookings/${b.id}`) },
    },
  };
}

export function staffCreatedEmail(b) {
  return {
    type: 'booking_staff_created',
    to: b.email,
    subject: `FC Photography Lab – Booking Created by FC Staff – ${b.id}`,
    bookingId: b.id,
    trigger: 'booking.staffCreate',
    content: {
      heading: 'Booking created by FC Staff',
      intro: [`A Photography Lab booking has been created for you by ${b.createdBy?.name} (FC Staff). It is confirmed after FC-CC approval.`],
      rows: bookingRows(b),
      extraRows: [...fcRows(b), ...facultyRows(b), ['Booked by', 'Staff Admin']],
      action: bookingLink(b),
    },
  };
}

export function approvedEmail(b, trigger = 'booking.approved') {
  return {
    type: 'booking_approved',
    to: b.email,
    subject: `FC Photography Lab Booking Approved – ${b.id}`,
    bookingId: b.id,
    trigger,
    content: {
      heading: 'Your booking is approved',
      intro: [
        'Your Photography Lab booking is approved. Please carry your NIFT ID card and follow the lab rules.',
        ...(b.isSpecial
          ? [ADMIN_GUARD_NOTE]
          : ['No printing is needed — your booking is approved in the system. You may optionally print the booking slip from the portal.']),
      ],
      rows: bookingRows(b),
      extraRows: [...fcRows(b), ...facultyRows(b), ...peopleRows(b)],
      action: bookingLink(b),
    },
  };
}

/** To the institute admin (e.g. admin.jodhpur@nift.ac.in) when the FC-CC approves. */
export function adminApprovedNoticeEmail(b, to) {
  const a = b.fcccApproval || b.special?.steps?.final || {};
  return {
    type: 'admin_approval_notice',
    to: to || [],
    subject: `FC-CC approved – FC Photography Lab booking ${b.id}${b.isSpecial ? ' (special permission)' : ''}`,
    bookingId: b.id,
    trigger: 'booking.approved.adminNotice',
    content: {
      heading: `FC-CC has approved booking ${b.id}`,
      intro: [
        `The FC-CC${a.byName ? ` (${a.byName})` : ''} has approved this FC Photography Lab booking.`,
        ...(b.isSpecial
          ? [`This is a special-permission booking (${(b.specialReasons || []).join(', ') || 'outside regular hours'}). Everyone using the lab is listed below with hostel and room.`]
          : []),
      ],
      rows: bookingRows(b),
      extraRows: [
        ['Student email', b.email],
        ['Student phone', b.phone],
        ['Booked by', b.bookedByStaff ? `FC Staff — ${b.createdBy?.name || ''}` : 'Student (online)'],
        ['Approved by', a.byName ? `${a.byName} (FC-CC)` : 'FC-CC'],
        ['Approved at', a.at ? formatDateTime(a.at) : ''],
        ['Digital signature', a.signature?.code || ''],
        ...fcRows(b),
        ...facultyRows(b),
        ...peopleRows(b),
      ],
      action: bookingLink(b),
    },
  };
}

export function fcRequestEmail(b, approvalId, fcEmail) {
  return {
    type: 'fc_approval_request',
    to: fcEmail,
    subject: `FC Photography Lab – Approval Required – ${b.id}`,
    bookingId: b.id,
    trigger: 'fcApproval.request',
    content: {
      heading: 'FC student approval required',
      intro: [
        `${b.studentName} (${b.department}, Semester ${b.semester}) has named you as the FC student involved in this Photography Lab booking.`,
        'Please sign in with your NIFT Google account to approve or reject this request.',
      ],
      rows: bookingRows(b),
      action: { label: 'Review approval request', url: appLink(`/approvals/${approvalId}`) },
      note: 'The link requires you to sign in with your NIFT Google account.',
    },
  };
}

export function fcApprovedEmail(b) {
  return {
    type: 'fc_approval_received',
    to: b.email,
    subject: `FC Student Approval Received – ${b.id}`,
    bookingId: b.id,
    trigger: 'fcApproval.approved',
    content: {
      heading: 'FC student approval received',
      intro: [`${b.fcStudent?.name} has approved your booking request.`],
      rows: bookingRows(b),
      extraRows: fcRows(b),
      action: bookingLink(b),
    },
  };
}

export function fcRejectedEmail(b, reason) {
  return {
    type: 'fc_approval_rejected',
    to: b.email,
    subject: `FC Photography Lab – FC Student Approval Rejected – ${b.id}`,
    bookingId: b.id,
    trigger: 'fcApproval.rejected',
    content: {
      heading: 'FC student approval rejected',
      intro: [
        `${b.fcStudent?.name} has rejected the approval request for your booking. The slot has been released.`,
      ],
      rows: bookingRows(b),
      extraRows: [...fcRows(b), ['Reason', reason || 'Not provided']],
      action: bookingLink(b),
    },
  };
}

export function specialRequiredEmail(b, to, forAdmins = false) {
  return {
    type: forAdmins ? 'special_approval_admin' : 'special_approval_required',
    to,
    subject: `FC Photography Lab – Special Approval Required – ${b.id}`,
    bookingId: b.id,
    trigger: 'special.required',
    content: {
      heading: 'Special approval required',
      intro: forAdmins
        ? ['A booking outside regular lab hours is awaiting the special approval workflow.']
        : [
            'This booking is outside regular lab hours and requires additional approval.',
            ...specialInstructionsFor(b.studentType),
          ],
      rows: bookingRows(b),
      extraRows: [
        ['Reason for special approval', (b.specialReasons || []).join(', ')],
        ['Approval chain', `${specialStepsFor(b.studentType).map((s) => s.label).join(' → ')} → Admin Guard`],
        ...peopleRows(b),
      ],
      action: forAdmins
        ? { label: 'Open booking', url: appLink(`/bookings/${b.id}`) }
        : { label: 'Open & print approval sheet', url: appLink(`/print/${b.id}`) },
    },
  };
}

export function formIssuedEmail(b) {
  const route = specialStepsFor(b.studentType).filter((x) => x.paper || x.key === 'final').map((x, i) => `${i + 1}. ${x.todo}.`);
  return {
    type: 'special_form_issued',
    to: b.email,
    subject: `FC Photography Lab – Approval Form Issued – ${b.id}`,
    bookingId: b.id,
    trigger: 'special.formIssued',
    content: {
      heading: 'Your approval form has been issued',
      intro: ['The FC Lab Assistant has printed your special-hours booking form. Next:', ...route, ADMIN_GUARD_NOTE],
      rows: bookingRows(b),
      action: { label: 'Track your booking', url: appLink(`/bookings/${b.id}`) },
    },
  };
}

export function rejectedEmail(b, reason) {
  return {
    type: 'booking_rejected',
    to: b.email,
    subject: `FC Photography Lab Booking Rejected – ${b.id}`,
    bookingId: b.id,
    trigger: 'booking.rejected',
    content: {
      heading: 'Your booking has been rejected',
      intro: ['Your Photography Lab booking has been rejected and the slot has been released.'],
      rows: bookingRows(b),
      extraRows: [['Reason', reason || 'Not provided']],
      action: bookingLink(b),
    },
  };
}

export function cancelledEmail(b, to, byLabel, reason, blockedUntil = null) {
  return {
    type: 'booking_cancelled',
    to,
    subject: `FC Photography Lab Booking Cancelled – ${b.id}`,
    bookingId: b.id,
    trigger: 'booking.cancelled',
    content: {
      heading: 'Booking cancelled',
      intro: [
        `This Photography Lab booking was cancelled by ${byLabel}.`,
        ...(blockedUntil ? [`As you cancelled this booking, you can't make a new booking until ${formatDateTime(blockedUntil)}.`] : []),
      ],
      rows: bookingRows(b),
      extraRows: [['Reason', reason || 'Not provided']],
      action: bookingLink(b),
    },
  };
}

export function facultyEmail(b, url) {
  return {
    type: 'faculty_information',
    to: b.faculty.email,
    subject: `FC Photography Lab Booking – Information – ${b.id}`,
    bookingId: b.id,
    trigger: 'faculty.inform',
    content: {
      heading: `Dear ${b.faculty.name},`,
      intro: [
        'This is an informational notification regarding a Photography Lab booking. Faculty approval is not required by default.',
        `${b.studentName} has listed you as the subject/faculty for this booking.`,
        'If you did NOT approve or are not aware of this booking, please use the button below. The booking will be reviewed by the FC Staff/FC-CC — it is not cancelled automatically.',
      ],
      rows: bookingRows(b),
      action: { label: 'I DID NOT APPROVE THIS', url },
      note: 'You will be asked to sign in with your NIFT Google account before your response is recorded.',
    },
  };
}

export function facultyConcernAdminEmail(b, to, remarks) {
  return {
    type: 'faculty_concern_admin',
    to,
    subject: `FC Photography Lab – Faculty Concern – ${b.id}`,
    bookingId: b.id,
    trigger: 'faculty.concern',
    content: {
      heading: 'Faculty concern reported',
      intro: [`${b.faculty?.name} (${b.faculty?.email}) reported: "I DID NOT APPROVE THIS". Please review the booking.`],
      rows: bookingRows(b),
      extraRows: [['Faculty remarks', remarks || '—']],
      action: { label: 'Review booking', url: appLink(`/bookings/${b.id}`) },
    },
  };
}

export function facultyConcernStudentEmail(b) {
  return {
    type: 'faculty_concern_student',
    to: b.email,
    subject: `FC Photography Lab Booking Under Review – ${b.id}`,
    bookingId: b.id,
    trigger: 'faculty.concern',
    content: {
      heading: 'Your booking is under review',
      intro: [
        'The faculty listed on your booking has reported a concern. Your booking has not been cancelled; the FC Staff/FC-CC will review it and update you.',
      ],
      rows: bookingRows(b),
      action: bookingLink(b),
    },
  };
}

export function seniorEmail(b) {
  return {
    type: 'senior_information',
    to: b.senior?.email,
    subject: `FC Photography Lab – You Are Listed as Senior Student – ${b.id}`,
    bookingId: b.id,
    trigger: 'booking.create',
    content: {
      heading: 'You are listed as the senior student',
      intro: [
        `${b.studentName} (first-year, Semester ${b.semester}) has listed you as the senior student accompanying them in the Photography Lab.`,
        'If this is not correct, please inform the FC Staff.',
      ],
      rows: bookingRows(b),
    },
  };
}

export function concernResolvedEmail(b, decisionLabel, remarks) {
  return {
    type: 'faculty_concern_resolved',
    to: b.email,
    subject: `FC Photography Lab – Review Completed – ${b.id}`,
    bookingId: b.id,
    trigger: 'faculty.concernResolved',
    content: {
      heading: 'Review completed',
      intro: [`The review of your booking is complete. Decision: ${decisionLabel}.`],
      rows: bookingRows(b),
      extraRows: [['Remarks', remarks || '—']],
      action: bookingLink(b),
    },
  };
}
