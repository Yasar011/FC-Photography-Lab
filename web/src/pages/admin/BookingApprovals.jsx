import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../lib/auth.jsx';
import { useNow } from '../../lib/hooks.js';
import { call } from '../../firebase.js';
import { PageHead } from '../../components/ui.jsx';
import { useActionDialog } from '../../components/SignApprove.jsx';
import { FcccActions, FcStepActions } from '../../components/BookingBits.jsx';
import { ApprovalTabs, ApprovalList } from '../../components/ApprovalList.jsx';
import { useStatusList } from './AdminDashboard.jsx';
import { STATUS } from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime } from '@shared/calendar.js';

/**
 * Approvals — NORMAL bookings only (special bookings live on Special approvals):
 *  • To approve: waiting for the FC-CC
 *  • Approved:   upcoming approved bookings
 */
export default function BookingApprovals() {
  const { role, isFccc } = useAuth();
  const now = useNow(60000);
  const pending = useStatusList(STATUS.PENDING_FCCC_APPROVAL);
  const fcWaiting = useStatusList(STATUS.PENDING_FC_APPROVAL);
  const approved = useStatusList(STATUS.APPROVED);
  const [openDialog, dialogNode] = useActionDialog();

  const byStart = (a, b) => a.startAt - b.startAt;
  const toApprove = pending.items.filter((b) => !b.isSpecial).sort(byStart);
  const upcoming = approved.items.filter((b) => b.endAt > now && !b.isSpecial).sort(byStart);
  const waitingFc = fcWaiting.items.filter((b) => b.endAt > now).sort(byStart);

  const [tab, setTab] = useState('approve');

  const cancel = (b) =>
    openDialog({
      title: `Cancel ${b.id}`,
      message: `Cancel ${b.studentName}'s booking (${formatDate(b.date, { weekday: true })} · ${formatRange(b.startHour, b.endHour)})? The slot is released and the student is emailed.`,
      confirmLabel: 'Cancel booking',
      tone: 'danger',
      remarks: 'required',
      remarksLabel: 'Reason (sent to the student)',
      onConfirm: async (reason) => {
        await call('cancelBooking', { bookingId: b.id, reason });
        return 'Booking cancelled';
      },
    });

  const tabs = [
    { key: 'approve', label: 'To approve', n: toApprove.length, hot: true, hint: isFccc ? 'Open a booking to check it, then Sign & approve or Reject.' : 'Only the FC-CC can approve these.' },
    { key: 'fc', label: 'Waiting for FC student', n: waitingFc.length, hot: true, hint: 'Other-department bookings waiting for their FC student. If the FC student does not respond, FC staff can approve or reject on their behalf.' },
    { key: 'approved', label: 'Approved', n: upcoming.length, hint: 'Confirmed by the FC-CC. No printing needed.' },
  ];
  const current = tabs.find((t) => t.key === tab);
  const list = tab === 'approve' ? toApprove : tab === 'fc' ? waitingFc : upcoming;

  const actionsFor = (b) => {
    if (tab === 'approve') return <FcccActions booking={b} role={role} onDialog={openDialog} compact />;
    if (tab === 'fc') return <FcStepActions booking={b} role={role} onDialog={openDialog} compact />;
    return isFccc ? <button className="btn btn-sm btn-ghost" onClick={() => cancel(b)}>Cancel</button> : null;
  };

  return (
    <>
      <PageHead eyebrow={isFccc ? 'FC-CC' : 'FC Lab Assistant'} title="Approvals">
        <span className="live-dot">Live</span>
      </PageHead>

      <ApprovalTabs tabs={tabs} tab={tab} onChange={setTab} />
      <p className="small muted" style={{ margin: '0 0 12px' }}>
        {current.hint} Special bookings (after 10 PM / weekend / holiday) are in <Link to="/admin/special">Special approvals</Link>.
      </p>
      <ApprovalList
        items={list}
        actionsFor={actionsFor}
        tagsFor={(b) => (b.isSpecial ? <span className="appr-tag special">Special</span> : null)}
        noteFor={(b) => (tab === 'fc' && b.fcStudent ? `FC student: ${b.fcStudent.name} (${b.fcStudent.niftId}) · asked ${formatDateTime(b.createdAt)}` : null)}
      />
      {dialogNode}
    </>
  );
}
