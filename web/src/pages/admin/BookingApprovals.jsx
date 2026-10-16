import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../lib/auth.jsx';
import { useNow } from '../../lib/hooks.js';
import { call } from '../../firebase.js';
import { PageHead } from '../../components/ui.jsx';
import { useActionDialog } from '../../components/SignApprove.jsx';
import { FcccActions } from '../../components/BookingBits.jsx';
import { useStatusList } from './AdminDashboard.jsx';
import Icon from '../../components/Icon.jsx';
import { STATUS, STUDENT_TYPE_LABELS } from '@shared/constants.js';
import { formatDate, formatRange, todayIST } from '@shared/calendar.js';

/**
 * Approvals — NORMAL bookings only (special bookings live on Special approvals):
 *  • To approve: waiting for the FC-CC
 *  • Approved:   upcoming approved bookings
 */
export default function BookingApprovals() {
  const { role, isFccc } = useAuth();
  const now = useNow(60000);
  const today = todayIST(now);
  const pending = useStatusList(STATUS.PENDING_FCCC_APPROVAL);
  const approved = useStatusList(STATUS.APPROVED);
  const [openDialog, dialogNode] = useActionDialog();

  const byStart = (a, b) => a.startAt - b.startAt;
  const toApprove = pending.items.filter((b) => !b.isSpecial).sort(byStart);
  const upcoming = approved.items.filter((b) => b.endAt > now && !b.isSpecial).sort(byStart);

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
    { key: 'approve', label: 'To approve', n: toApprove.length, hint: isFccc ? 'Open a booking to check it, then Sign & approve or Reject.' : 'Only the FC-CC can approve these.' },
    { key: 'approved', label: 'Approved', n: upcoming.length, hint: 'Confirmed by the FC-CC. No printing needed.' },
  ];
  const current = tabs.find((t) => t.key === tab);
  const list = tab === 'approve' ? toApprove : upcoming;

  const actionsFor = (b) => {
    if (tab === 'approve') return <FcccActions booking={b} role={role} onDialog={openDialog} compact />;
    return isFccc ? <button className="btn btn-sm btn-ghost" onClick={() => cancel(b)}>Cancel</button> : null;
  };

  return (
    <>
      <PageHead eyebrow={isFccc ? 'FC-CC' : 'FC Lab Assistant'} title="Approvals">
        <span className="live-dot">Live</span>
      </PageHead>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label} <span className={`tab-n ${t.n && t.key !== 'approved' ? 'hot' : ''}`}>{t.n}</span>
          </button>
        ))}
      </div>
      <p className="small muted" style={{ margin: '0 0 12px' }}>
        {current.hint} Special bookings (after 10 PM / weekend / holiday) are in <Link to="/admin/special">Special approvals</Link>.
      </p>

      {list.length === 0 ? (
        <div className="appr-empty"><Icon name="check" /> Nothing here.</div>
      ) : (
        <div className="appr-list">
          {list.map((b) => (
            <div key={b.id} className="appr-row">
              <Link to={`/bookings/${b.id}`} className="appr-when">
                <b>{b.date === today ? 'Today' : formatDate(b.date, { weekday: true })}</b>
                <span>{formatRange(b.startHour, b.endHour)}</span>
              </Link>
              <Link to={`/bookings/${b.id}`} className="appr-main">
                <div className="appr-name">
                  {b.studentName}
                  <span className="appr-tag">{STUDENT_TYPE_LABELS[b.studentType]}</span>
                </div>
                <div className="small muted appr-purpose">{b.purpose}</div>
              </Link>
              <div className="appr-actions">{actionsFor(b)}</div>
            </div>
          ))}
        </div>
      )}
      {dialogNode}
    </>
  );
}
