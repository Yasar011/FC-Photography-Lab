import { Link } from 'react-router-dom';

import { useAuth } from '../../lib/auth.jsx';
import { PageHead } from '../../components/ui.jsx';
import { useActionDialog } from '../../components/SignApprove.jsx';
import { SpecialActions, nextSpecialStep } from '../../components/BookingBits.jsx';
import { useStatusList } from './AdminDashboard.jsx';
import Icon from '../../components/Icon.jsx';
import { STATUS } from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime } from '@shared/calendar.js';

const COLUMNS = [
  { key: 'fcAssistant', icon: 'print', title: '1 · Print & issue form', hint: 'FC Assistant prints the form and hands it to the student.' },
  { key: 'director', icon: 'user', title: '2 · With student → Director', hint: 'Student gets the Director’s signature and returns the form to FC-CC.' },
  { key: 'final', icon: 'stamp', title: '3 · FC-CC final approval', hint: 'Signed form received — FC-CC gives the final approval.' },
];

export default function SpecialApprovals() {
  const { role } = useAuth();
  const { items, loading } = useStatusList(STATUS.PENDING_SPECIAL_APPROVAL);
  const [openDialog, dialogNode] = useActionDialog();

  const byStep = Object.fromEntries(COLUMNS.map((c) => [c.key, []]));
  for (const b of items) {
    const next = nextSpecialStep(b);
    if (next) byStep[next.key].push(b);
  }

  return (
    <>
      <PageHead eyebrow="After 10 PM · Weekend · Holiday" title="Special approvals" sub="FC Assistant prints the form → student takes it to the Director → student returns it to FC-CC → final approval.">
        <span className="live-dot">Live</span>
      </PageHead>
      {loading ? <p className="muted">Loading…</p> : (
        <div className="board">
          {COLUMNS.map((c) => (
            <div key={c.key} className="board-col">
              <h3><Icon name={c.icon} /> {c.title} <span className="n">{byStep[c.key].length}</span></h3>
              <div className="hint">{c.hint}</div>
              {byStep[c.key].length === 0 && <p className="small muted" style={{ padding: '10px 4px' }}>Nothing here.</p>}
              {byStep[c.key].map((b) => {
                const issued = b.special?.steps?.fcAssistant;
                return (
                  <div key={b.id} className="bcard">
                    <div className="top">
                      <Link to={`/bookings/${b.id}`} className="booking-id small">{b.id}</Link>
                      <span className="badge plain tone-orange">{(b.specialReasons || []).join(', ') || 'Special'}</span>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{b.studentName} <span className="small muted">· {b.niftId}</span></div>
                      <div className="small">{formatDate(b.date, { weekday: true })} · {formatRange(b.startHour, b.endHour)}</div>
                      <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.purpose}</div>
                      {issued && c.key !== 'fcAssistant' && <div className="tiny muted" style={{ marginTop: 4 }}>Form issued by {issued.byName} · {formatDateTime(issued.at)}</div>}
                    </div>
                    <SpecialActions booking={b} role={role} onDialog={openDialog} compact />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {dialogNode}
    </>
  );
}
