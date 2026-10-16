import { Link } from 'react-router-dom';

import { useAuth } from '../../lib/auth.jsx';
import { useNow } from '../../lib/hooks.js';
import { call } from '../../firebase.js';
import { PageHead } from '../../components/ui.jsx';
import { useActionDialog } from '../../components/SignApprove.jsx';
import { AssistantActions, SpecialActions, nextSpecialStep } from '../../components/BookingBits.jsx';
import { useStatusList } from './AdminDashboard.jsx';
import Icon from '../../components/Icon.jsx';
import { STATUS, STUDENT_TYPE_LABELS } from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime, todayIST } from '@shared/calendar.js';

/**
 * FC Lab Assistant portal:
 *  - New bookings (normal bookings are confirmed instantly — check them, cancel if needed)
 *  - Special bookings whose form must be printed & issued
 *  - Bookings waiting for approval (only when approval is switched on)
 */
export default function BookingApprovals() {
  const { role, isStaff, rules } = useAuth();
  const now = useNow(60000);
  const today = todayIST(now);
  const pending = useStatusList(STATUS.PENDING_ASSISTANT_APPROVAL);
  const special = useStatusList(STATUS.PENDING_SPECIAL_APPROVAL);
  const approved = useStatusList(STATUS.APPROVED);
  const [openDialog, dialogNode] = useActionDialog();

  const toPrint = special.items.filter((b) => nextSpecialStep(b)?.key === 'fcAssistant');
  const fresh = approved.items
    .filter((b) => b.endAt > now && !b.isSpecial)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 20);
  const showApprovalColumn = pending.items.length > 0 || rules.assistantApproval !== 'none';

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

  const card = (b, actions, extra) => (
    <div key={b.id} className="bcard">
      <div className="top">
        <Link to={`/bookings/${b.id}`} className="booking-id small">{b.id}</Link>
        {b.date === today && <span className="badge tone-red">Today</span>}
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>{b.studentName} <span className="small muted">· {b.niftId} · {STUDENT_TYPE_LABELS[b.studentType]}</span></div>
        <div className="small">{formatDate(b.date, { weekday: true })} · {formatRange(b.startHour, b.endHour)} ({b.duration} h)</div>
        <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.purpose}</div>
        {b.faculty && <div className="tiny muted">Faculty: {b.faculty.name}</div>}
        {extra}
      </div>
      {actions}
    </div>
  );

  return (
    <>
      <PageHead
        eyebrow="FC Lab Assistant"
        title="Bookings desk"
        sub="Normal bookings are confirmed instantly — check new ones and cancel if needed. Special bookings: print the form and hand it to the student."
      >
        <span className="live-dot">Live</span>
      </PageHead>
      <div className="board">
        {showApprovalColumn && (
          <div className="board-col">
            <h3><Icon name="checkCircle" /> Waiting for approval <span className="n">{pending.items.length}</span></h3>
            <div className="hint">Approval is switched on in Rules & Questions.</div>
            {pending.items.length === 0 && <p className="small muted" style={{ padding: '10px 4px' }}>Nothing waiting.</p>}
            {pending.items.map((b) => card(b, <AssistantActions booking={b} role={role} onDialog={openDialog} compact />))}
          </div>
        )}
        <div className="board-col">
          <h3><Icon name="calendar" /> New & upcoming bookings <span className="n">{fresh.length}</span></h3>
          <div className="hint">Newest first. No printing needed.</div>
          {fresh.length === 0 && <p className="small muted" style={{ padding: '10px 4px' }}>No upcoming bookings.</p>}
          {fresh.map((b) => card(b, (
            <div className="row" style={{ gap: 8 }}>
              {isStaff && <button className="btn btn-sm btn-danger" onClick={() => cancel(b)}>Cancel</button>}
              <Link className="btn btn-sm btn-ghost" to={`/print/${b.id}`}><Icon name="print" /> Slip (optional)</Link>
            </div>
          ), <div className="tiny muted" style={{ marginTop: 4 }}>Booked {formatDateTime(b.createdAt)}{b.bookedByStaff ? ' · by staff' : ''}</div>))}
        </div>
        <div className="board-col">
          <h3><Icon name="print" /> Special: print & issue form <span className="n">{toPrint.length}</span></h3>
          <div className="hint">After 10 PM · weekend · holiday. Print the form and hand it to the student.</div>
          {toPrint.length === 0 && <p className="small muted" style={{ padding: '10px 4px' }}>Nothing to print.</p>}
          {toPrint.map((b) => card(b, <SpecialActions booking={b} role={role} onDialog={openDialog} compact />, (
            <div className="tiny" style={{ marginTop: 4, color: 'var(--orange)' }}>{(b.specialReasons || []).join(', ')}</div>
          )))}
        </div>
      </div>
      {dialogNode}
    </>
  );
}
