import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { SPECIAL_STEPS, STATUS, STUDENT_TYPE_LABELS, APPROVER_ROLES, specialStepsFor, ADMIN_GUARD_NOTE, approvalChain } from '@shared/constants.js';
import { formatDate, formatDateTime, formatRange } from '@shared/calendar.js';
import { call } from '../firebase.js';
import { DigitalStamp } from './SignApprove.jsx';
import { useToast } from './ui.jsx';

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
            onConfirm: async ({ remarks }) => {
              await call('specialApprovalStep', { bookingId: booking.id, step: 'final', decision: 'approve', remarks });
              return 'Approved & signed';
            },
          })}
        >
          <Icon name="stamp" /> {compact ? 'Sign & approve' : 'Paper signatures OK → Sign & approve'}
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
 * Waiting for the FC student (other departments): FC staff can approve or
 * reject on the FC student's behalf, e.g. when the FC student doesn't respond.
 */
export function FcStepActions({ booking, role, onDialog, compact = false }) {
  if (booking.status !== STATUS.PENDING_FC_APPROVAL || !role || !booking.fcApprovalId) return null;
  const sz = compact ? 'btn-sm' : '';
  const fc = booking.fcStudent ? `${booking.fcStudent.name} (${booking.fcStudent.niftId})` : 'the FC student';
  const answer = (decision) => onDialog({
    title: decision === 'approve' ? `Approve for ${booking.fcStudent?.name || 'FC student'}` : `Reject ${booking.id}`,
    message: decision === 'approve'
      ? `Approve the FC-student step for ${booking.studentName}'s booking on behalf of ${fc}. It then goes to the FC-CC for final approval.`
      : `Reject ${booking.studentName}'s booking at the FC-student step (on behalf of ${fc}). The slot is released and the student is emailed.`,
    confirmLabel: decision === 'approve' ? 'Approve for FC student' : 'Reject',
    tone: decision === 'approve' ? 'primary' : 'danger',
    remarks: decision === 'approve' ? 'optional' : 'required',
    remarksLabel: decision === 'approve' ? 'Note (optional)' : 'Reason (sent to the student)',
    onConfirm: async (reason) => {
      await call('respondFcApproval', { approvalId: booking.fcApprovalId, decision, reason });
      return decision === 'approve' ? 'Approved — sent to the FC-CC' : 'Booking rejected';
    },
  });
  return (
    <div className="row" style={{ gap: 8 }}>
      <button className={`btn btn-primary ${sz}`} onClick={() => answer('approve')}><Icon name="check" /> Approve for FC student</button>
      <button className={`btn btn-danger ${sz}`} onClick={() => answer('reject')}>Reject</button>
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
            onConfirm: async ({ remarks }) => {
              await call('adminBookingDecision', { bookingId: booking.id, decision: 'approve', remarks });
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
    b.participants?.length ? [`People using the lab (${b.participants.length})`, (
      <ol className="people-ol">
        {b.participants.map((p, i) => <li key={i}><b>{p.name}</b> · {p.department} · {p.hostel}, Room {p.room}</li>)}
      </ol>
    )] : null,
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
/** True when a booking has stored signature images (older bookings, before text signatures). */
export function hasStoredSignatures(b) {
  if (!b) return false;
  if (b.signature?.path || b.fcccApproval?.signaturePath) return true;
  return Object.values(b.special?.steps || {}).some((s) => s?.signaturePath || s?.documentPath);
}

export function useBookingSignatures(bookingId, version, enabled = true) {
  const [state, setState] = useState({ loading: enabled, sigs: {}, error: '' });
  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, sigs: {}, error: '' });
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    call('getBookingSignatures', { bookingId })
      .then((r) => alive && setState({ loading: false, sigs: r.signatures || {}, error: '' }))
      .catch((e) => alive && setState({ loading: false, sigs: {}, error: e.message }));
    return () => {
      alive = false;
    };
  }, [bookingId, version, enabled]);
  return state;
}

/**
 * Signatures on a booking, in order. Only people who actually sign appear:
 * student, Dept CC / subject faculty (other departments, special bookings),
 * Director and FC-CC. The FC Lab Assistant and Director's PA only pass the form on.
 */
/** Older special bookings used the printed form (FC Lab Assistant → paper signatures). */
export const isPaperSpecial = (b) => b?.status === STATUS.PENDING_SPECIAL_APPROVAL || Boolean(b?.special?.steps?.fcAssistant);

/** Has this step of the approval chain approved? */
function stepRecord(b, key) {
  if (key === 'fcStudent') return b.fcApproval?.state === 'APPROVED' ? { by: b.fcApproval.byName, at: b.fcApproval.at } : null;
  if (key === 'deptCc') return b.deptCcApproval?.decision === 'approve' ? { by: b.deptCcApproval.byName, at: b.deptCcApproval.at, remarks: b.deptCcApproval.remarks, signature: b.deptCcApproval.signature } : null;
  if (key === 'fccc') return b.fcccApproval ? { by: b.fcccApproval.byName, at: b.fcccApproval.at, remarks: b.fcccApproval.remarks, signature: b.fcccApproval.signature } : null;
  if (key === 'director') return b.directorApproval?.decision === 'approve' ? { by: b.directorApproval.byName, at: b.directorApproval.at, remarks: b.directorApproval.remarks, signature: b.directorApproval.signature } : null;
  return null;
}

/** The approval chain, step by step: done ✓ / now / next. */
export function ApprovalTracker({ booking: b }) {
  const chain = approvalChain(b);
  const waitingFor = b.status === STATUS.FACULTY_CONCERN ? b.facultyConcern?.previousStatus : b.status;
  const ended = [STATUS.REJECTED, STATUS.CANCELLED_BY_ADMIN, STATUS.CANCELLED_BY_STUDENT].includes(b.status);
  const rows = [
    { key: 'student', label: 'Student submitted', state: 'done', at: b.createdAt },
    ...chain.map((st) => {
      const rec = stepRecord(b, st.key);
      return {
        key: st.key,
        label: st.key === 'deptCc' || st.key === 'director' ? `${st.label} (by email)` : st.label,
        state: rec ? 'done' : !ended && waitingFor === st.status ? 'now' : 'next',
        at: rec?.at,
        by: rec?.by,
        remarks: rec?.remarks,
      };
    }),
    { key: 'admin', label: 'Institute admin informed', state: [STATUS.APPROVED, STATUS.COMPLETED].includes(b.status) ? 'done' : 'next' },
  ];
  return (
    <ol className="chain">
      {rows.map((r) => (
        <li key={r.key} className={`chain-step ${r.state}`}>
          <span className="chain-dot" aria-hidden>{r.state === 'done' ? '✓' : ''}</span>
          <div>
            <div className="chain-label">{r.label}{r.state === 'now' ? <span className="chain-now">{b.status === STATUS.FACULTY_CONCERN ? 'on hold — faculty concern' : 'waiting'}</span> : null}</div>
            {(r.by || r.at) && <div className="tiny muted">{[r.by, r.at ? formatDateTime(r.at) : null].filter(Boolean).join(' · ')}</div>}
            {r.remarks && <div className="tiny">“{r.remarks}”</div>}
          </div>
        </li>
      ))}
      {ended && <li className="chain-step ended"><span className="chain-dot" aria-hidden>✕</span><div className="chain-label">{STATUS_LABEL_TEXT[b.status] || b.status}{b.rejection?.reason ? ` — ${b.rejection.reason}` : ''}</div></li>}
    </ol>
  );
}
const STATUS_LABEL_TEXT = { REJECTED: 'Rejected', CANCELLED_BY_ADMIN: 'Cancelled by FC-CC', CANCELLED_BY_STUDENT: 'Cancelled by student' };

/** Dept CC / Director decide from a one-click email; staff can re-send it. */
export function EmailStepActions({ booking: b, role, compact = false }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (![STATUS.PENDING_DEPT_CC, STATUS.PENDING_DIRECTOR].includes(b.status) || !role) return null;
  const who = b.status === STATUS.PENDING_DIRECTOR ? 'the Director' : `the ${b.department} CC`;
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="small muted">Approval email sent to {who}.</span>
      <button
        className={`btn btn-ghost ${compact ? 'btn-sm' : ''}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await call('resendDecisionEmail', { bookingId: b.id });
            toast(`Email sent again${r?.sentTo ? ` to ${r.sentTo}` : ''}`, 'ok');
          } catch (e) {
            toast(e.message, 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="mail" /> Resend email
      </button>
    </div>
  );
}

export function signatureEntries(b, sigs) {
  const steps = b.special?.steps || {};
  const out = [
    {
      key: 'student',
      role: 'Student',
      name: b.signature?.signerName || b.studentName,
      at: b.signature?.signedAt,
      img: sigs.student,
      stamp: b.signature?.digital ? b.signature : null,
      note: b.signature?.signedBy && b.signature.signedBy !== b.signature.signerName ? `Entered by ${b.signature.signedBy}` : 'Declaration & undertaking',
    },
  ];
  if (!isPaperSpecial(b)) {
    const chain = approvalChain(b);
    const done = [STATUS.APPROVED, STATUS.COMPLETED].includes(b.status);
    chain.forEach((st, i) => {
      const rec = stepRecord(b, st.key);
      const last = i === chain.length - 1;
      if (st.key === 'fcStudent') {
        out.push({ key: st.key, role: 'FC student', pending: !rec, name: rec?.by, at: rec?.at, note: rec ? 'Approved online' : null });
      } else {
        out.push({ key: st.key, role: `${st.label}${last && done ? ' — Approved' : ''}`, pending: !rec, name: rec?.by, at: rec?.at, stamp: rec?.signature || null, approved: last && done, note: rec?.remarks || null });
      }
    });
    return out;
  }
  if (!b.isSpecial) {
    const a = b.fcccApproval;
    out.push({ key: 'fccc', role: 'FC-CC — Approved', pending: !a, name: a?.byName, at: a?.at, img: sigs.fccc, stamp: a?.signature || null, approved: Boolean(a) });
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
      out.push({ key: 'fccc', role: 'FC-CC — Approved', pending: !st, name: st?.byName, at: st?.at, img: sigs['special.final'], stamp: st?.signature || null, approved: st?.state === 'approved' });
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
  const { loading, sigs, error } = useBookingSignatures(booking.id, version, hasStoredSignatures(booking));
  const entries = signatureEntries(booking, sigs);
  return (
    <div className="sig-grid">
      {entries.map((e) => (
        <div key={e.key} className={`sig-card ${e.pending ? 'pending' : ''}`}>
          <div className="sig-role">{e.role}</div>
          <div className="sig-box">
            {e.approved && !e.stamp && <span className="approved-stamp">APPROVED</span>}
            {e.stamp ? (
              <DigitalStamp sig={e.stamp} bookingId={booking.id} approved={e.approved} />
            ) : e.img ? (
              <img src={e.img} alt={`${e.role} signature`} className={e.doc ? 'doc' : ''} />
            ) : (
              <span className="small muted">{loading ? 'Loading…' : e.pending ? 'Pending' : e.key === 'fc' ? 'Approved online' : e.paper ? (e.doc ? 'Signed on paper (no photo attached)' : 'Signed on paper') : 'No signature on file'}</span>
            )}
          </div>
          {e.name && !e.stamp && <div className="sig-name">{e.name}</div>}
          <div className="tiny muted">{e.stamp ? (e.note || '') : <>{e.at ? formatDateTime(e.at) : ''}{e.note ? `${e.at ? ' · ' : ''}${e.note}` : ''}</>}</div>
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
