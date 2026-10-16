import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { useLive } from '../lib/hooks.js';
import { call } from '../firebase.js';
import { StatusBadge, Loading, Alert } from '../components/ui.jsx';
import { useActionDialog } from '../components/SignApprove.jsx';
import { BookingFacts, HistoryTimeline, SpecialTracker, SpecialActions, AssistantActions, SignaturesPanel } from '../components/BookingBits.jsx';
import Icon from '../components/Icon.jsx';
import { STATUS, ACTIVE_STATUSES, STATUS_META } from '@shared/constants.js';
import { formatDate, formatDateTime, formatRange } from '@shared/calendar.js';

const TONE_COLOR = { green: 'var(--ev-approved)', orange: 'var(--ev-pending)', yellow: 'var(--ev-pending)', red: 'var(--red)', black: 'var(--black)', blue: 'var(--ev-booked)' };

export default function BookingDetail() {
  const { id } = useParams();
  const { user, role, isAdmin, isStaff, rules } = useAuth();
  const { value: b, loading, error } = useLive(`bookings/${id}`, [id]);
  const [ask, dialogNode] = useActionDialog();

  if (loading) return <Loading />;
  if (error || !b) {
    return <Alert kind="error">Booking {id} was not found, or you do not have access to it. <Link to="/">Go home</Link></Alert>;
  }

  const isOwner = b.studentUid === user.uid;
  const active = ACTIVE_STATUSES.includes(b.status);
  const canStudentCancel = isOwner && active && rules.studentCanCancel && b.startAt > Date.now();
  const adminCanApprove = isAdmin && [STATUS.SUBMITTED, STATUS.FC_APPROVED].includes(b.status);
  const assistantPending = b.status === STATUS.PENDING_ASSISTANT_APPROVAL;
  const tone = STATUS_META[b.status]?.tone;

  const open = {
    cancel: () => ask({
      title: 'Cancel booking', message: `Cancel ${b.id}? The slot is released for other students.`, confirmLabel: 'Cancel booking', tone: 'danger',
      remarks: isOwner ? 'optional' : 'required', remarksLabel: 'Reason',
      onConfirm: async (reason) => { await call('cancelBooking', { bookingId: b.id, reason }); return 'Booking cancelled'; },
    }),
    approve: () => ask({
      title: 'Approve booking', confirmLabel: 'Approve', tone: 'green', remarks: 'optional',
      onConfirm: async (remarks) => { await call('adminBookingDecision', { bookingId: b.id, decision: 'approve', remarks }); return 'Booking approved'; },
    }),
    reject: () => ask({
      title: 'Reject booking', message: 'The student is notified and the slot released.', confirmLabel: 'Reject', tone: 'danger', remarks: 'required', remarksLabel: 'Reason',
      onConfirm: async (remarks) => { await call('adminBookingDecision', { bookingId: b.id, decision: 'reject', remarks }); return 'Booking rejected'; },
    }),
    concern: (decision) => ask({
      title: decision === 'approve' ? 'Approve despite faculty concern' : 'Reject — uphold faculty concern',
      message: decision === 'approve' ? 'The booking returns to its workflow (pending FC/special approvals still apply).' : 'The booking is rejected and the slot released.',
      confirmLabel: decision === 'approve' ? 'Approve' : 'Reject', tone: decision === 'approve' ? 'green' : 'danger', remarks: 'required',
      onConfirm: async (remarks) => { await call('resolveFacultyConcern', { bookingId: b.id, decision, remarks }); return 'Decision recorded'; },
    }),
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => window.history.back()}><Icon name="chevronLeft" /> Back</button>
      </div>

      <header className="row" style={{ alignItems: 'flex-start', gap: 16, marginBottom: 22, flexWrap: 'nowrap' }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, background: TONE_COLOR[tone] || 'var(--primary)', marginTop: 9, flex: 'none' }} />
        <div className="grow">
          <h1 style={{ fontWeight: 500, fontSize: 26 }}>{b.purpose}</h1>
          <div className="muted" style={{ marginTop: 4 }}>
            {formatDate(b.date, { weekday: true })} · {formatRange(b.startHour, b.endHour)} · {b.duration} h
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <StatusBadge status={b.status} />
            <span className="booking-id small">{b.id}</span>
            {b.bookedByStaff && <span className="badge plain tone-violet">Booked by Staff Admin</span>}
            <span className="live-dot">Live</span>
          </div>
        </div>
      </header>

      <div className="stack-lg">
        {b.status === STATUS.PENDING_FC_APPROVAL && <Alert kind="warn">Waiting for {b.fcStudent?.name} ({b.fcStudent?.niftId}) to approve from their own account.</Alert>}
        {b.status === STATUS.FACULTY_CONCERN && (
          <Alert kind="warn">
            <span><b>Faculty concern:</b> {b.facultyConcern?.facultyName} reported “I DID NOT APPROVE THIS” on {formatDateTime(b.facultyConcern?.at)}. {b.facultyConcern?.remarks && `Remarks: ${b.facultyConcern.remarks}. `}The booking is under review — it has not been cancelled.</span>
          </Alert>
        )}
        {b.facultyConcern?.resolution && (
          <Alert kind="info">Faculty concern reviewed by {b.facultyConcern.resolution.byName}: {b.facultyConcern.resolution.decision === 'approve' ? 'Approved' : 'Rejected'} — {b.facultyConcern.resolution.remarks}</Alert>
        )}

        {(canStudentCancel || isAdmin || (b.fcStudentUid === user.uid && b.fcApprovalId)) && (
          <div className="row">
            {adminCanApprove && <button className="btn btn-green" onClick={open.approve}><Icon name="check" /> Approve</button>}
            {isAdmin && b.status === STATUS.FACULTY_CONCERN && (
              <>
                <button className="btn btn-green" onClick={() => open.concern('approve')}>Approve (dismiss concern)</button>
                <button className="btn btn-danger" onClick={() => open.concern('reject')}>Reject (uphold concern)</button>
              </>
            )}
            {isAdmin && active && !assistantPending && b.status !== STATUS.PENDING_SPECIAL_APPROVAL && b.status !== STATUS.FACULTY_CONCERN && <button className="btn btn-danger" onClick={open.reject}>Reject</button>}
            {canStudentCancel && <button className="btn btn-danger" onClick={open.cancel}>Cancel booking</button>}
            {isStaff && active && !isOwner && <button className="btn btn-ghost" onClick={open.cancel}><Icon name="trash" /> Cancel (admin)</button>}
            {(isAdmin || isOwner) && b.isSpecial && b.status !== STATUS.PENDING_SPECIAL_APPROVAL && <Link className="btn btn-ghost" to={`/print/${b.id}`}><Icon name="print" /> Print form</Link>}
            {b.fcStudentUid === user.uid && b.fcApprovalId && <Link className="btn btn-tonal" to={`/approvals/${b.fcApprovalId}`}>Open FC approval</Link>}
          </div>
        )}

        <div className="split">
          <div className="stack-lg">
            {b.isSpecial && (
              <section className="card">
                <div className="card-head">
                  <h2>Special approval</h2>
                  <span className="small muted">{(b.specialReasons || []).join(', ')}</span>
                </div>
                <div className="card-body stack-lg">
                  <SpecialTracker booking={b} forStudent={isOwner} />
                  {isAdmin && <SpecialActions booking={b} role={role} onDialog={ask} />}
                </div>
              </section>
            )}
            {!b.isSpecial && b.status === STATUS.PENDING_ASSISTANT_APPROVAL && (
              <section className="card">
                <div className="card-head"><h2>FC Lab Assistant approval</h2></div>
                <div className="card-body stack">
                  <p className="small">{isOwner ? 'Your booking has been sent to the FC Lab Assistant. You will get an email once it is approved.' : 'The student has signed this booking. Approve or reject it — no printing is needed.'}</p>
                  {isAdmin && <AssistantActions booking={b} role={role} onDialog={ask} />}
                </div>
              </section>
            )}
            {!b.isSpecial && [STATUS.APPROVED, STATUS.COMPLETED].includes(b.status) && (
              <Alert kind="ok">
                <span>
                  <b>No printing needed</b> — this booking is approved in the system{b.assistantApproval ? ` by ${b.assistantApproval.byName}` : ''}. Show your Booking ID at the lab.{' '}
                  <Link to={`/print/${b.id}`}>Print booking slip (optional)</Link>
                </span>
              </Alert>
            )}
            {(isOwner || isAdmin || b.fcStudentUid === user.uid || b.seniorUid === user.uid) && (
              <section className="card">
                <div className="card-head">
                  <h2>Signatures</h2>
                  <span className="small muted">Everyone involved can see these</span>
                </div>
                <div className="card-body"><SignaturesPanel booking={b} /></div>
              </section>
            )}
            <section className="card">
              <div className="card-head"><h2>Details</h2></div>
              <div className="card-body"><BookingFacts b={b} admin={isAdmin} /></div>
            </section>
            <section className="card">
              <div className="card-head"><h2>{b.declaration?.title || 'Declaration'}</h2></div>
              <div className="card-body stack">
                <div className="declaration">{b.declaration?.text}</div>
                {Object.values(b.declaration?.confirmations || {}).map((c, i) => (
                  <div key={i} className="small">{c.checked ? '☑' : '☐'} {c.label}</div>
                ))}
              </div>
            </section>
          </div>
          <section className="card">
            <div className="card-head"><h2>Status history</h2></div>
            <div className="card-body"><HistoryTimeline history={b.history} /></div>
          </section>
        </div>
      </div>
      {dialogNode}
    </>
  );
}
