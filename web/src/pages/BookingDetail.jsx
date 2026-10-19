import { Link, useParams, useLocation } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { useLive } from '../lib/hooks.js';
import { call } from '../firebase.js';
import { StatusBadge, Loading, Alert } from '../components/ui.jsx';
import { useActionDialog } from '../components/SignApprove.jsx';
import { BookingFacts, HistoryTimeline, SpecialTracker, SpecialActions, FcccActions, FcStepActions, SignaturesPanel, ApprovalTracker, EmailStepActions, isPaperSpecial } from '../components/BookingBits.jsx';
import Icon from '../components/Icon.jsx';
import { STATUS, ACTIVE_STATUSES, STATUS_META } from '@shared/constants.js';
import { formatDate, formatDateTime, formatRange } from '@shared/calendar.js';

const TONE_COLOR = { green: 'var(--ev-approved)', orange: 'var(--ev-pending)', yellow: 'var(--ev-pending)', red: 'var(--red)', black: 'var(--black)', blue: 'var(--ev-booked)' };

export default function BookingDetail() {
  const { id } = useParams();
  const { user, role, isAdmin, isFccc, rules } = useAuth();
  const { value: b, loading, error } = useLive(`bookings/${id}`, [id]);
  // Opened from a signature QR code: check the code against the booking's signatures.
  const verifyCode = new URLSearchParams(useLocation().search).get('verify');
  const [ask, dialogNode] = useActionDialog();

  if (loading) return <Loading />;
  if (error || !b) {
    return <Alert kind="error">Booking {id} was not found, or you do not have access to it. <Link to="/">Go home</Link></Alert>;
  }

  const isOwner = b.studentUid === user.uid;
  const active = ACTIVE_STATUSES.includes(b.status);
  const canStudentCancel = isOwner && active && rules.studentCanCancel && b.startAt > Date.now();
  const fcccPending = [STATUS.PENDING_FCCC_APPROVAL, STATUS.SUBMITTED, STATUS.FC_APPROVED].includes(b.status);
  const tone = STATUS_META[b.status]?.tone;

  const open = {
    cancel: () => ask({
      title: 'Cancel booking',
      message: isOwner && Number(rules.cancelCooldownDays) > 0 && b.status === STATUS.APPROVED
        && b.startAt - Date.now() <= Number(rules.cancelBlockWithinHours ?? 24) * 3600000
        ? <span>Cancel {b.id}? The slot is released for other students. <b>If you cancel, you can't make a new booking for {rules.cancelCooldownDays} days (until {formatDateTime(Date.now() + rules.cancelCooldownDays * 86400000)}).</b></span>
        : `Cancel ${b.id}? The slot is released for other students.`,
      confirmLabel: 'Cancel booking', tone: 'danger',
      remarks: isOwner ? 'optional' : 'required', remarksLabel: 'Reason',
      onConfirm: async (reason) => {
        const r = await call('cancelBooking', { bookingId: b.id, reason });
        return r.blockedUntil ? `Booking cancelled — you can book again from ${formatDateTime(r.blockedUntil)}` : 'Booking cancelled';
      },
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
        {verifyCode && <VerifyBanner b={b} code={verifyCode} />}
        {b.status === STATUS.PENDING_FC_APPROVAL && (
          <Alert kind="warn">
            <div className="stack" style={{ gap: 8 }}>
              <span>Waiting for {b.fcStudent?.name} ({b.fcStudent?.niftId}) to approve from their own account.{isAdmin ? ' As FC staff you can also answer on their behalf:' : ''}</span>
              {isAdmin && <FcStepActions booking={b} role={role} onDialog={ask} />}
            </div>
          </Alert>
        )}
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
                        {isFccc && b.status === STATUS.FACULTY_CONCERN && (
              <>
                <button className="btn btn-green" onClick={() => open.concern('approve')}>Approve (dismiss concern)</button>
                <button className="btn btn-danger" onClick={() => open.concern('reject')}>Reject (uphold concern)</button>
              </>
            )}
            {isFccc && active && !fcccPending && b.status !== STATUS.PENDING_SPECIAL_APPROVAL && b.status !== STATUS.FACULTY_CONCERN && <button className="btn btn-danger" onClick={open.reject}>Reject</button>}
            {canStudentCancel && <button className="btn btn-danger" onClick={open.cancel}>Cancel booking</button>}
            {isFccc && active && !isOwner && <button className="btn btn-ghost" onClick={open.cancel}><Icon name="trash" /> Cancel (FC-CC)</button>}
            {(isAdmin || isOwner) && isPaperSpecial(b) && b.status !== STATUS.PENDING_SPECIAL_APPROVAL && <Link className="btn btn-ghost" to={`/print/${b.id}`}><Icon name="print" /> Print form</Link>}
            {b.fcStudentUid === user.uid && b.fcApprovalId && <Link className="btn btn-tonal" to={`/approvals/${b.fcApprovalId}`}>Open FC approval</Link>}
          </div>
        )}

        <div className="split">
          <div className="stack-lg">
            {!isPaperSpecial(b) && (
              <section className="card">
                <div className="card-head">
                  <h2>Approvals</h2>
                  {b.isSpecial && <span className="small muted">Special: {(b.specialReasons || []).join(', ')}</span>}
                </div>
                <div className="card-body stack-lg">
                  <ApprovalTracker booking={b} />
                  {isAdmin && <FcccActions booking={b} role={role} onDialog={ask} />}
                  {isAdmin && <EmailStepActions booking={b} role={role} />}
                </div>
              </section>
            )}
            {isPaperSpecial(b) && (
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
            {!isPaperSpecial(b) && [STATUS.APPROVED, STATUS.COMPLETED].includes(b.status) && (
              <Alert kind="ok">
                <span>
                  <b>No printing needed</b> — this booking is approved and the institute admin is informed. Show your Booking ID and NIFT ID card at the lab.{' '}
                  <Link to={`/print/${b.id}`}>Print booking slip (optional)</Link>
                </span>
              </Alert>
            )}
            {(b.equipmentLog || (isAdmin && [STATUS.APPROVED, STATUS.COMPLETED].includes(b.status))) && (
              <section className="card">
                <div className="card-head"><h2>Equipment</h2><span className="small muted">{(b.equipmentList || []).join(', ')}</span></div>
                <div className="card-body stack">
                  <EquipmentLog b={b} />
                  {isAdmin && <EquipmentActions b={b} ask={ask} />}
                </div>
              </section>
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

/** Issued / returned record of the lab equipment for one booking. */
function EquipmentLog({ b }) {
  const log = b.equipmentLog || {};
  if (!log.issued) return <p className="small muted" style={{ margin: 0 }}>Not issued yet.</p>;
  return (
    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
      <li><b>Issued</b> by {log.issued.byName} · {formatDateTime(log.issued.at)}{log.issued.note ? ` — ${log.issued.note}` : ''}</li>
      {log.returned ? (
        <li style={log.returned.condition === 'issue' ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
          <b>Returned</b> {log.returned.condition === 'issue' ? 'with a problem' : 'OK'} · {log.returned.byName} · {formatDateTime(log.returned.at)}{log.returned.note ? ` — ${log.returned.note}` : ''}
        </li>
      ) : (
        <li className="muted">Not returned yet</li>
      )}
    </ul>
  );
}

function EquipmentActions({ b, ask }) {
  const log = b.equipmentLog || {};
  const record = (action, condition) => ask({
    title: action === 'issue' ? 'Equipment issued' : condition === 'issue' ? 'Returned with a problem' : 'Equipment returned OK',
    message: action === 'issue'
      ? `Record that ${(b.equipmentList || []).join(', ')} was handed to ${b.studentName}.`
      : condition === 'issue'
        ? 'Describe what is damaged or missing. It shows in Equipment usage → Problems.'
        : `Record that everything was returned in good condition by ${b.studentName}.`,
    confirmLabel: action === 'issue' ? 'Mark issued' : 'Mark returned',
    tone: condition === 'issue' ? 'danger' : 'primary',
    remarks: condition === 'issue' ? 'required' : 'optional',
    remarksLabel: condition === 'issue' ? 'What is the problem?' : 'Note (optional)',
    onConfirm: async (note) => {
      await call('recordEquipment', { bookingId: b.id, action, condition, note });
      return action === 'issue' ? 'Marked as issued' : 'Marked as returned';
    },
  });
  if (!log.issued) return <div className="row"><button className="btn btn-primary" onClick={() => record('issue')}><Icon name="check" /> Mark equipment issued</button></div>;
  if (!log.returned) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-green" onClick={() => record('return', 'ok')}><Icon name="check" /> Returned OK</button>
        <button className="btn btn-danger" onClick={() => record('return', 'issue')}><Icon name="alert" /> Returned with a problem</button>
      </div>
    );
  }
  return null;
}

/** Shown when the page is opened by scanning a signature QR code. */
function VerifyBanner({ b, code }) {
  const sigs = [b.signature, b.fcccApproval?.signature, b.special?.steps?.final?.signature].filter((x) => x?.code);
  const match = sigs.find((x) => x.code === code);
  if (!match) return <Alert kind="error"><b>Signature code {code} does not match this booking.</b> The printed form may not be genuine.</Alert>;
  return (
    <Alert kind="ok">
      <span>
        <b>✓ Signature verified</b>: {match.code} was signed by <b>{match.name}</b> ({match.role}) on {formatDateTime(match.at)}. Booking status now:{' '}
        <b>{STATUS_META[b.status]?.label || b.status}</b>.
      </span>
    </Alert>
  );
}
