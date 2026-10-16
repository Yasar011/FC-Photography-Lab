import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { useLive } from '../lib/hooks.js';
import { call } from '../firebase.js';
import { PageHead, Loading, Alert, ConfirmModal, useToast, TypeBadge } from '../components/ui.jsx';
import { FC_APPROVAL_STATE } from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime } from '@shared/calendar.js';

const STATE_UI = {
  PENDING: ['orange', 'Awaiting your response'],
  APPROVED: ['green', 'FC Student Approved'],
  REJECTED: ['red', 'FC Student Rejected'],
  CANCELLED: ['black', 'Cancelled'],
};

export function ApprovalCard({ a, footer }) {
  const [tone, label] = STATE_UI[a.state] || ['grey', a.state];
  return (
    <section className="card">
      <div className="card-head">
        <div className="booking-id">BOOKING ID: {a.bookingId}</div>
        <span className={`badge tone-${tone}`}>{label}</span>
      </div>
      <div className="card-body">
        <dl className="kv">
          <dt>Student</dt><dd>{a.requester?.name}</dd>
          <dt>NIFT ID</dt><dd className="mono">{a.requester?.niftId}</dd>
          <dt>Department</dt><dd>{a.requester?.department} <TypeBadge type={a.requester?.studentType} /></dd>
          <dt>Semester</dt><dd>{a.requester?.semester}</dd>
          <dt>Date</dt><dd>{formatDate(a.date, { weekday: true })}</dd>
          <dt>Time</dt><dd>{formatRange(a.startHour, a.endHour)}</dd>
          <dt>Purpose</dt><dd>{a.purpose}</dd>
          <dt>Equipment</dt><dd>{(a.equipmentList || []).join(', ')}</dd>
          {a.isSpecial && (<><dt>Note</dt><dd>Outside regular hours — special approval follows after yours.</dd></>)}
          {a.respondedAt && (<><dt>Responded</dt><dd>{formatDateTime(a.respondedAt)}{a.reason ? ` — ${a.reason}` : ''}</dd></>)}
        </dl>
        {footer && <div className="row" style={{ marginTop: 14 }}>{footer}</div>}
      </div>
    </section>
  );
}

export default function ApprovalDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { value: a, loading, error } = useLive(`fcApprovals/${id}`, [id]);
  const [dialog, setDialog] = useState(null);
  const toast = useToast();

  if (loading) return <Loading />;
  if (error || !a) return <Alert kind="error">This approval request was not found or is not assigned to you. <Link to="/approvals">My FC Approvals</Link></Alert>;
  if (a.fcStudentUid !== user.uid) return <Alert kind="error">This approval request is assigned to another student.</Alert>;

  const respond = (decision) =>
    setDialog({
      title: decision === 'approve' ? 'Approve this booking' : 'Reject this booking',
      message:
        decision === 'approve'
          ? `You confirm that you (${a.fcStudentName}) are involved in ${a.requester?.name}'s Photography Lab booking.`
          : 'The booking will be rejected and the slot released. You may give a reason.',
      confirmLabel: decision === 'approve' ? 'APPROVE' : 'REJECT',
      tone: decision === 'approve' ? 'green' : 'danger',
      remarks: decision === 'approve' ? 'none' : 'optional',
      remarksLabel: 'Reason for rejection',
      onConfirm: async (reason) => {
        await call('respondFcApproval', { approvalId: id, decision, reason });
        toast(decision === 'approve' ? 'FC student approval recorded' : 'Request rejected', 'ok');
      },
    });

  return (
    <>
      <PageHead eyebrow="FC approval request" title="Approval request" sub="Sign-in verified with your NIFT Google account.">
        <span className="live-dot">Live</span>
      </PageHead>
      <ApprovalCard
        a={a}
        footer={
          a.state === FC_APPROVAL_STATE.PENDING ? (
            <>
              <button className="btn btn-green btn-lg" onClick={() => respond('approve')}>APPROVE</button>
              <button className="btn btn-danger btn-lg" onClick={() => respond('reject')}>REJECT</button>
            </>
          ) : (
            <Link className="btn" to={`/bookings/${a.bookingId}`}>View booking</Link>
          )
        }
      />
      {dialog && <ConfirmModal {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
