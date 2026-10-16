import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { SPECIAL_STEPS, STATUS, STUDENT_TYPE_LABELS, APPROVER_ROLES, specialStepsFor, ADMIN_GUARD_NOTE } from '@shared/constants.js';
import { formatDate, formatDateTime, formatRange } from '@shared/calendar.js';
import { call } from '../firebase.js';

export function HistoryTimeline({ history }) {
  const entries = Object.values(history || {}).sort((a, b) => a.at - b.at);
  if (!entries.length) return <p className="muted small">No history yet.</p>;
  return (
    <ol className="timeline">
      {entries.map((h, i) => (
        <li key={i}>
          <div className="t-when">{formatDateTime(h.at)}</div>
          <div className="t-what">{h.event}</div>
          <div className="t-by">
            By: {h.by}
            {h.role && h.role !== 'system' ? ` · ${roleName(h.role)}` : ''}
          </div>
          {h.note && <div className="small">{h.note}</div>}
        </li>
      ))}
    </ol>
  );
}

const roleName = (r) =>
  ({ student: 'Student', main: 'Main Admin', staff: 'Staff Admin', fccc: 'FC-CC', faculty: 'Faculty', fc_student: 'FC Student' })[r] || r;

/**
 * Next *portal* step of a special (out-of-hours) booking: the FC Lab Assistant
 * issues the printed form, then the FC-CC approves & signs. Paper signatures in
 * between are carried by the student. Returns the step def, or null.
 */
export function nextSpecialStep(b) {
  if (b.status !== STATUS.PENDING_SPECIAL_APPROVAL) return null;
  const done = b.special?.steps?.fcAssistant?.state === 'approved';
  return SPECIAL_STEPS.find((s) => s.key === (done ? 'final' : 'fcAssistant'));
}

export function SpecialTracker({ booking, forStudent = false }) {
  const steps = booking.special?.steps || {};
  const route = specialStepsFor(booking.studentType);
  const issued = steps.fcAssistant?.state === 'approved';
  const pending = booking.status === STATUS.PENDING_SPECIAL_APPROVAL;
  // While the form is with the student, the first paper step is "current".
  const currentKey = pending ? (issued ? route.find((s) => s.paper)?.key : 'fcAssistant') : null;
  const approved = booking.status === STATUS.APPROVED || booking.status === STATUS.COMPLETED;
  return (
    <ol className="track">
      <li className="done">
        <span className="mark">✓</span>
        <div><div className="t-title">Booking submitted & signed by {booking.studentName}</div><div className="t-meta">{formatDateTime(booking.createdAt)}</div></div>
      </li>
      {route.map((s, i) => {
        const st = steps[s.key];
        const done = st?.state === 'approved';
        const rejected = st?.state === 'rejected';
        const current = s.key === currentKey;
        const withStudent = pending && issued && s.paper;
        let meta = '';
        if (st && s.paper) meta = `On paper · verified by ${st.verifiedBy || st.byName} · ${formatDateTime(st.at)}`;
        else if (st) meta = `${st.byName} · ${formatDateTime(st.at)}${st.remarks ? ` — ${st.remarks}` : ''}`;
        else if (withStudent) meta = 'Signed on the paper form — carried by the student';
        else if (current) meta = `Waiting · ${s.label}`;
        else meta = s.paper ? `${s.label} · on paper` : s.label;
        return (
          <li key={s.key} className={done ? 'done' : rejected ? 'rejected' : current ? 'current' : ''}>
            <span className="mark">{done ? '✓' : rejected ? '✕' : i + 1}</span>
            <div>
              <div className="t-title">{done ? s.done : rejected ? `Rejected by ${s.label}` : s.todo}</div>
              <div className="t-meta">{meta}</div>
              {forStudent && current && (
                <div className="you">
                  {s.key === 'fcAssistant'
                    ? 'Visit the FC office — the FC Lab Assistant will print your form. Quote your Booking ID.'
                    : `Take the printed form: ${route.filter((x) => x.paper).map((x) => x.label).join(' → ')} → back to the FC-CC.`}
                </div>
              )}
            </div>
          </li>
        );
      })}
      <li className={approved ? 'current' : ''}>
        <span className="mark">★</span>
        <div>
          <div className="t-title"><b>{ADMIN_GUARD_NOTE}</b></div>
          {approved && forStudent && <div className="you"><b>Your booking is approved. Hand the signed form to the Admin Guard.</b></div>}
        </div>
      </li>
    </ol>
  );
}

/** Role-aware buttons for the next special-approval step. */
export function SpecialActions({ booking, role, onDialog, compact = false, hidePrint = false }) {
  const next = nextSpecialStep(booking);
  if (!next || !role) return null;
  const sz = compact ? 'btn-sm' : '';
  const paper = specialStepsFor(booking.studentType).filter((s) => s.paper).map((s) => s.label);
  const reject = () =>
    onDialog({
      title: `Reject ${booking.id}`,
      message: `Reject at the ${next.label} stage? The slot will be released and the student notified.`,
      confirmLabel: 'Reject',
      tone: 'danger',
      remarks: 'required',
      remarksLabel: 'Reason',
      onConfirm: async (remarks) => {
        await call('specialApprovalStep', { bookingId: booking.id, step: next.key, decision: 'reject', remarks });
        return 'Booking rejected';
      },
    });
  // Only the FC-CC can reject; the FC Lab Assistant just prints & hands over the form.
  const rejectBtn = APPROVER_ROLES.includes(role) ? <button className={`btn btn-danger ${sz}`} onClick={reject}>Reject</button> : null;
  const printBtn = hidePrint ? null : (
    <Link className={`btn btn-tonal ${sz}`} to={`/print/${booking.id}`}>
      <Icon name="print" /> {next.key === 'fcAssistant' ? 'Print form' : 'Reprint form'}
    </Link>
  );

  if (next.key === 'fcAssistant' && next.roles.includes(role)) {
    return (
      <div className="row" style={{ gap: 8 }}>
        {printBtn}
        <button
          className={`btn btn-primary ${sz}`}
          onClick={() => onDialog({
            title: 'Form printed & issued',
            message: `Confirm the printed form for ${booking.id} was handed to ${booking.studentName}. Route: ${paper.join(' → ')} → FC-CC. (No signature needed from you.)`,
            confirmLabel: 'Mark as issued',
            remarks: 'optional',
            onConfirm: async (remarks) => {
              await call('specialApprovalStep', { bookingId: booking.id, step: 'fcAssistant', decision: 'approve', remarks });
              return 'Form marked as issued';
            },
          })}
        >
          <Icon name="check" /> Issued to student
        </button>
        {rejectBtn}
      </div>
    );
  }
  if (next.key === 'final' && next.roles.includes(role)) {
    return (
      <div className="row" style={{ gap: 8 }}>
        {printBtn}
        <button
          className={`btn btn-green ${sz}`}
          onClick={() => onDialog({
            kind: 'sign',
            title: 'Approve & sign — special booking',
            message: `Check the paper form for ${booking.id} (${booking.studentName}) has been signed by: ${specialStepsFor(booking.studentType).filter((x) => x.paper && x.signs).map((x) => x.label).join(', ')}. Your digital signature and “APPROVED” are added, and the student then gives the form to the Admin Guard.`,
            confirmLabel: 'Sign & approve',
            allowDocument: true,
            onConfirm: async ({ signature, remarks, document }) => {
              await call('specialApprovalStep', { bookingId: booking.id, step: 'final', decision: 'approve', signature, remarks, document });
              return 'Approved & signed';
            },
          })}
        >
          <Icon name="stamp" /> Paper signatures OK → Sign & approve
        </button>
        {rejectBtn}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="small muted">{next.key === 'fcAssistant' ? 'Waiting for the FC Lab Assistant to print & issue the form.' : `Form is with the student (${paper.join(' → ')}). FC-CC approves when it returns.`}</p>
      {printBtn && <div className="row">{printBtn}</div>}
    </div>
  );
}

/**
 * FC-CC approval of a normal booking (nothing is confirmed without it).
 * FC-CC / Main Admin: Sign & approve. Other admins see who it is waiting for and can reject.
 */
export function FcccActions({ booking, role, onDialog, compact = false }) {
  const waiting = [STATUS.PENDING_FCCC_APPROVAL, STATUS.SUBMITTED, STATUS.FC_APPROVED].includes(booking.status);
  if (!waiting || !role) return null;
  const sz = compact ? 'btn-sm' : '';
  const canApprove = APPROVER_ROLES.includes(role);
  if (!canApprove) return <span className="small muted">Waiting for the FC-CC to approve.</span>;
  return (
    <div className="row" style={{ gap: 8 }}>
      <button
          className={`btn btn-green ${sz}`}
          onClick={() => onDialog({
            kind: 'sign',
            title: `Approve ${booking.id}`,
            message: `Approve ${booking.studentName}'s booking (${formatDate(booking.date, { weekday: true })} · ${formatRange(booking.startHour, booking.endHour)}). Your digital signature and “APPROVED” are added. No printing is needed.`,
            confirmLabel: 'Sign & approve',
            onConfirm: async ({ signature, remarks }) => {
              await call('adminBookingDecision', { bookingId: booking.id, decision: 'approve', signature, remarks });
              return 'Approved & signed';
            },
          })}
        >
          <Icon name="stamp" /> Sign & approve
        </button>
      <button
        className={`btn btn-danger ${sz}`}
        onClick={() => onDialog({
          title: `Reject ${booking.id}`,
          message: 'The slot is released and the student notified.',
          confirmLabel: 'Reject',
          tone: 'danger',
          remarks: 'required',
          remarksLabel: 'Reason',
          onConfirm: async (remarks) => {
            await call('adminBookingDecision', { bookingId: booking.id, decision: 'reject', remarks });
            return 'Booking rejected';
          },
        })}
      >
        Reject
      </button>
    </div>
  );
}

export function BookingFacts({ b, admin = false }) {
  const rows = [
    ['Booking ID', <span className="booking-id">{b.id}</span>],
    ['Date', formatDate(b.date, { weekday: true })],
    ['Time', `${formatRange(b.startHour, b.endHour)} (${b.duration} h)`],
    ['Purpose', b.purpose],
    ['Requirements', (b.equipmentList || []).join(', ')],
    ...Object.values(b.equipmentReasons || {}).map((r) => [r.label, r.value]),
    ['Student', `${b.studentName} (${b.niftId})`],
    ['Department / Sem', `${b.department} · Semester ${b.semester}`],
    ['Student type', STUDENT_TYPE_LABELS[b.studentType] || b.studentType],
    admin ? ['Phone', b.phone] : null,
    admin ? ['Email', b.email] : null,
    b.fcStudent ? ['FC student involved', `${b.fcStudent.name} (${b.fcStudent.niftId})`] : null,
    b.fcApproval ? ['FC approval', `${b.fcApproval.state} by ${b.fcApproval.byName} · ${formatDateTime(b.fcApproval.at)}${b.fcApproval.reason ? ` — ${b.fcApproval.reason}` : ''}`] : null,
    b.senior ? ['Senior student', `${b.senior.name} (${b.senior.niftId}), Sem ${b.senior.semester}`] : null,
    b.faculty ? ['Subject / Faculty', `${b.faculty.name} — ${b.faculty.email}`] : null,
    b.isSpecial ? ['Special approval', (b.specialReasons || []).join(', ') || 'Required'] : null,
    b.usesOverride ? ['Availability', 'Uses a slot opened by FC Staff (Admin Override)'] : null,
    b.bringsOwnCamera ? ['Camera', 'Brings personal / department camera (FC camera not issued)'] : null,
    ...Object.values(b.answers || {}).map((a) => [a.label, a.value === true ? 'Yes' : String(a.value)]),
    ['Booked by', b.bookedByStaff ? `Staff Admin — ${b.createdBy?.name}` : 'Student'],
    ['Created', formatDateTime(b.createdAt)],
    ['Last updated', formatDateTime(b.updatedAt)],
    b.remarks ? ['Staff remarks', b.remarks] : null,
    b.cancellation ? ['Cancellation', `${b.cancellation.byName} · ${formatDateTime(b.cancellation.at)}${b.cancellation.reason ? ` — ${b.cancellation.reason}` : ''}`] : null,
    b.rejection ? ['Rejection', `${b.rejection.byName} · ${b.rejection.reason || ''}`] : null,
  ].filter(Boolean);
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SignatureView({ bookingId, signature }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    call('getSignature', { bookingId })
      .then((r) => alive && setUrl(r.dataUrl))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [bookingId]);
  return (
    <div className="stack">
      {url ? <img className="sigimg" src={url} alt={`Signature of ${signature?.signerName}`} /> : <span className="muted small">{error || 'Loading signature…'}</span>}
      <div className="small muted">
        Signed by {signature?.signerName} ({signature?.signerNiftId}) · {formatDateTime(signature?.signedAt)}
        {signature?.signedBy && signature.signedBy !== signature.signerName ? ` · entered by ${signature.signedBy}` : ''}
      </div>
    </div>
  );
}

// ---- All signatures on a booking (everyone involved can see them) -------------
export function useBookingSignatures(bookingId, version) {
  const [state, setState] = useState({ loading: true, sigs: {}, error: '' });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    call('getBookingSignatures', { bookingId })
      .then((r) => alive && setState({ loading: false, sigs: r.signatures || {}, error: '' }))
      .catch((e) => alive && setState({ loading: false, sigs: {}, error: e.message }));
    return () => {
      alive = false;
    };
  }, [bookingId, version]);
  return state;
}

/**
 * Signatures on a booking, in order. Only people who actually sign appear:
 * student, Dept CC / subject faculty (other departments, special bookings),
 * Director and FC-CC. The FC Lab Assistant and Director's PA only pass the form on.
 */
export function signatureEntries(b, sigs) {
  const steps = b.special?.steps || {};
  const out = [
    {
      key: 'student',
      role: 'Student',
      name: b.signature?.signerName || b.studentName,
      at: b.signature?.signedAt,
      img: sigs.student,
      note: b.signature?.signedBy && b.signature.signedBy !== b.signature.signerName ? `Entered by ${b.signature.signedBy}` : 'Declaration & undertaking',
    },
  ];
  if (!b.isSpecial) {
    const a = b.fcccApproval;
    out.push({ key: 'fccc', role: 'FC-CC — Approved', pending: !a, name: a?.byName, at: a?.at, img: sigs.fccc, approved: Boolean(a) });
    return out;
  }
  for (const s of specialStepsFor(b.studentType).filter((x) => x.signs)) {
    const st = steps[s.key];
    if (s.paper) {
      out.push({
        key: s.key,
        role: s.key === 'deptCc' ? `${b.department} CC / Subject Faculty` : s.label,
        paper: true,
        pending: !st,
        name: st ? 'Signed on the paper form' : null,
        at: st?.at,
        img: s.key === 'director' ? sigs['doc.director'] : null,
        doc: s.key === 'director',
        note: st ? `Verified by ${st.verifiedBy || st.byName}` : null,
      });
    } else {
      out.push({ key: 'fccc', role: 'FC-CC — Approved', pending: !st, name: st?.byName, at: st?.at, img: sigs['special.final'], approved: st?.state === 'approved' });
    }
  }
  return out;
}

/** Who passed the form along / approved in the portal (shown as text, not signatures). */
export function handlingNotes(b) {
  const notes = [];
  const steps = b.special?.steps || {};
  if (b.fcApproval?.state === 'APPROVED') notes.push(`FC student ${b.fcApproval.byName} approved online · ${formatDateTime(b.fcApproval.at)}`);
  if (steps.fcAssistant?.state === 'approved') notes.push(`Form printed & issued by FC Lab Assistant ${steps.fcAssistant.byName} · ${formatDateTime(steps.fcAssistant.at)}`);
  if (steps.directorPA?.state === 'approved') notes.push("Forwarded via the Director's PA");
  return notes;
}

export function SignaturesPanel({ booking }) {
  const version = JSON.stringify([booking.special?.steps, booking.fcccApproval, booking.fcApproval?.state]);
  const { loading, sigs, error } = useBookingSignatures(booking.id, version);
  const entries = signatureEntries(booking, sigs);
  return (
    <div className="sig-grid">
      {entries.map((e) => (
        <div key={e.key} className={`sig-card ${e.pending ? 'pending' : ''}`}>
          <div className="sig-role">{e.role}</div>
          <div className="sig-box">
            {e.approved && <span className="approved-stamp">APPROVED</span>}
            {e.img ? (
              <img src={e.img} alt={`${e.role} signature`} className={e.doc ? 'doc' : ''} />
            ) : (
              <span className="small muted">{loading ? 'Loading…' : e.pending ? 'Pending' : e.key === 'fc' ? 'Approved online' : e.paper ? (e.doc ? 'Signed on paper (no photo attached)' : 'Signed on paper') : 'No signature on file'}</span>
            )}
          </div>
          {e.name && <div className="sig-name">{e.name}</div>}
          <div className="tiny muted">{e.at ? formatDateTime(e.at) : ''}{e.note ? `${e.at ? ' · ' : ''}${e.note}` : ''}</div>
        </div>
      ))}
      {error && <p className="small muted">{error}</p>}
      {handlingNotes(booking).length > 0 && (
        <ul className="small muted" style={{ gridColumn: '1 / -1', margin: '4px 0 0', paddingLeft: 18 }}>
          {handlingNotes(booking).map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}
