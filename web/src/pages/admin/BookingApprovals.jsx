import { Link } from 'react-router-dom';

import { useAuth } from '../../lib/auth.jsx';
import { useNow } from '../../lib/hooks.js';
import { call } from '../../firebase.js';
import { PageHead } from '../../components/ui.jsx';
import { useActionDialog } from '../../components/SignApprove.jsx';
import { FcccActions, SpecialActions, nextSpecialStep } from '../../components/BookingBits.jsx';
import { useStatusList } from './AdminDashboard.jsx';
import Icon from '../../components/Icon.jsx';
import { STATUS, STUDENT_TYPE_LABELS } from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime, todayIST } from '@shared/calendar.js';

/**
 * Approvals desk — nothing is confirmed without the FC-CC:
 *  1. Normal bookings waiting for FC-CC approval (Sign & approve / Reject)
 *  2. Special bookings whose form the FC Lab Assistant must print & issue
 *  3. Approved upcoming bookings (cancel if needed; optional slip)
 */
export default function BookingApprovals() {
  const { role, isFccc } = useAuth();
  const now = useNow(60000);
  const today = todayIST(now);
  const pending = useStatusList(STATUS.PENDING_FCCC_APPROVAL);
  const special = useStatusList(STATUS.PENDING_SPECIAL_APPROVAL);
  const approved = useStatusList(STATUS.APPROVED);
  const [openDialog, dialogNode] = useActionDialog();

  const toPrint = special.items.filter((b) => nextSpecialStep(b)?.key === 'fcAssistant');
  const fresh = approved.items
    .filter((b) => b.endAt > now && !b.isSpecial)
    .sort((a, b) => a.startAt - b.startAt)
    .slice(0, 20);

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
        eyebrow={isFccc ? 'FC-CC' : 'FC Lab Assistant'}
        title="Approvals"
        sub="Every booking is confirmed only after FC-CC approval. FC Lab Assistant: print special-hours forms and hand them to students."
      >
        <span className="live-dot">Live</span>
      </PageHead>
      <div className="board">
        <div className="board-col">
          <h3><Icon name="stamp" /> Waiting for FC-CC approval <span className="n">{pending.items.length}</span></h3>
          <div className="hint">{isFccc ? 'Check and Sign & approve. Nothing is confirmed until you do.' : 'Only the FC-CC can approve these.'}</div>
          {pending.items.length === 0 && <p className="small muted" style={{ padding: '10px 4px' }}>Nothing waiting.</p>}
          {pending.items.map((b) => card(b, <FcccActions booking={b} role={role} onDialog={openDialog} compact />, (
            b.fcApproval?.state === 'APPROVED' && <div className="tiny muted" style={{ marginTop: 4 }}>FC student {b.fcApproval.byName} approved · {formatDateTime(b.fcApproval.at)}</div>
          )))}
        </div>
        <div className="board-col">
          <h3><Icon name="calendar" /> Approved — upcoming <span className="n">{fresh.length}</span></h3>
          <div className="hint">Approved by the FC-CC. No printing needed.</div>
          {fresh.length === 0 && <p className="small muted" style={{ padding: '10px 4px' }}>No upcoming bookings.</p>}
          {fresh.map((b) => card(b, (
            <div className="row" style={{ gap: 8 }}>
              {isFccc && <button className="btn btn-sm btn-danger" onClick={() => cancel(b)}>Cancel</button>}
              <Link className="btn btn-sm btn-ghost" to={`/print/${b.id}`}><Icon name="print" /> Slip (optional)</Link>
            </div>
          ), b.fcccApproval && <div className="tiny muted" style={{ marginTop: 4 }}>Approved by {b.fcccApproval.byName} · {formatDateTime(b.fcccApproval.at)}</div>))}
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
