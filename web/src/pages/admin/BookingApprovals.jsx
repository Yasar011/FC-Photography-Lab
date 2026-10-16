import { Link } from 'react-router-dom';

import { useAuth } from '../../lib/auth.jsx';
import { useNow } from '../../lib/hooks.js';
import { PageHead } from '../../components/ui.jsx';
import { useActionDialog } from '../../components/SignApprove.jsx';
import { AssistantActions, SpecialActions, nextSpecialStep } from '../../components/BookingBits.jsx';
import { useStatusList } from './AdminDashboard.jsx';
import Icon from '../../components/Icon.jsx';
import { STATUS, STUDENT_TYPE_LABELS } from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime, todayIST } from '@shared/calendar.js';

/**
 * FC Lab Assistant portal:
 *  1. Normal bookings waiting for approval (approve / reject — no printing needed)
 *  2. Special bookings whose form must be printed & issued
 *  3. Approved upcoming bookings (optional print)
 */
export default function BookingApprovals() {
  const { role } = useAuth();
  const now = useNow(60000);
  const today = todayIST(now);
  const pending = useStatusList(STATUS.PENDING_ASSISTANT_APPROVAL);
  const special = useStatusList(STATUS.PENDING_SPECIAL_APPROVAL);
  const approved = useStatusList(STATUS.APPROVED);
  const [openDialog, dialogNode] = useActionDialog();

  const toPrint = special.items.filter((b) => nextSpecialStep(b)?.key === 'fcAssistant');
  const upcoming = approved.items.filter((b) => b.endAt > now && !b.isSpecial).slice(0, 15);

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
        {b.fcApproval?.state === 'APPROVED' && <div className="tiny muted">FC student {b.fcApproval.byName} approved · {formatDateTime(b.fcApproval.at)}</div>}
        {extra}
      </div>
      {actions}
    </div>
  );

  return (
    <>
      <PageHead
        eyebrow="FC Lab Assistant"
        title="Booking approvals"
        sub="Normal bookings: approve in the portal — no printing needed. Special bookings: print the form and hand it to the student."
      >
        <span className="live-dot">Live</span>
      </PageHead>
      <div className="board">
        <div className="board-col">
          <h3><Icon name="checkCircle" /> 1 · Approve bookings <span className="n">{pending.items.length}</span></h3>
          <div className="hint">Student has signed the booking. Approve or reject.</div>
          {pending.items.length === 0 && <p className="small muted" style={{ padding: '10px 4px' }}>Nothing waiting.</p>}
          {pending.items.map((b) => card(b, <AssistantActions booking={b} role={role} onDialog={openDialog} compact />))}
        </div>
        <div className="board-col">
          <h3><Icon name="print" /> 2 · Special: print & issue form <span className="n">{toPrint.length}</span></h3>
          <div className="hint">After 10 PM · weekend · holiday. Print the form and hand it to the student.</div>
          {toPrint.length === 0 && <p className="small muted" style={{ padding: '10px 4px' }}>Nothing to print.</p>}
          {toPrint.map((b) => card(b, <SpecialActions booking={b} role={role} onDialog={openDialog} compact />, (
            <div className="tiny" style={{ marginTop: 4, color: 'var(--orange)' }}>{(b.specialReasons || []).join(', ')}</div>
          )))}
        </div>
        <div className="board-col">
          <h3><Icon name="calendar" /> 3 · Approved — upcoming <span className="n">{upcoming.length}</span></h3>
          <div className="hint">No printing needed. Print a slip only if someone asks for one.</div>
          {upcoming.length === 0 && <p className="small muted" style={{ padding: '10px 4px' }}>No upcoming bookings.</p>}
          {upcoming.map((b) => card(b, (
            <div className="row" style={{ gap: 8 }}>
              <Link className="btn btn-sm btn-ghost" to={`/print/${b.id}`}><Icon name="print" /> Print slip (optional)</Link>
            </div>
          ), b.assistantApproval && <div className="tiny muted" style={{ marginTop: 4 }}>Approved by {b.assistantApproval.byName} · {formatDateTime(b.assistantApproval.at)}</div>))}
        </div>
      </div>
      {dialogNode}
    </>
  );
}
