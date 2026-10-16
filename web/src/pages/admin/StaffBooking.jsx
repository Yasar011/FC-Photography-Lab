import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { orderByChild, equalTo } from 'firebase/database';

import { useLive, dbQuery } from '../../lib/hooks.js';
import BookingPlanner from '../../components/BookingPlanner.jsx';
import Icon from '../../components/Icon.jsx';
import { PageHead, Alert, TypeBadge, AccountBadge } from '../../components/ui.jsx';
import { normalizeNiftId } from '@shared/constants.js';
import { formatDate, formatRange } from '@shared/calendar.js';

export default function StaffBooking() {
  const [params] = useSearchParams();
  const pre = params.get('date') ? { date: params.get('date'), start: Number(params.get('start')), end: Number(params.get('end')) } : null;
  const [input, setInput] = useState(params.get('nift') || '');
  const [niftId, setNiftId] = useState(normalizeNiftId(params.get('nift') || ''));
  const q = niftId ? dbQuery('users', orderByChild('niftId'), equalTo(niftId)) : null;
  const { value, loading } = useLive(q, [niftId]);
  const found = value ? Object.values(value)[0] : null;

  return (
    <>
      <PageHead
        eyebrow="Staff Admin"
        title="Book for a student"
        sub="Normal booking rules and approvals still apply. The booking is marked “Booked by: Staff Admin”."
      />
      <form
        className="row"
        style={{ marginBottom: 18, alignItems: 'center' }}
        onSubmit={(e) => {
          e.preventDefault();
          setNiftId(normalizeNiftId(input));
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
          <input className="input mono" style={{ borderRadius: 24, paddingLeft: 44 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Student NIFT ID, e.g. BFT/23/041" aria-label="Student NIFT ID" />
          <span style={{ position: 'absolute', left: 14, top: 12, color: 'var(--muted)' }}><Icon name="user" /></span>
        </div>
        <button className="btn btn-primary" disabled={!input.trim()}>Find student</button>
        {pre && <span className="small muted">Selected time: {formatDate(pre.date, { weekday: true })} · {formatRange(pre.start, pre.end)}</span>}
      </form>

      {niftId && !loading && !found && <Alert kind="error">No registered student with NIFT ID {niftId}.</Alert>}
      {found && (
        <>
          <div className="card card-pad row-between" style={{ marginBottom: 18, background: 'var(--surface-2)', border: 'none' }}>
            <div className="row" style={{ gap: 14 }}>
              <span className="avatar" style={{ width: 44, height: 44 }}>{found.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{found.name}</div>
                <div className="small muted">{found.niftId} · {found.department} · Semester {found.semester} · {found.phone}</div>
              </div>
            </div>
            <div className="row"><TypeBadge type={found.studentType} /><AccountBadge status={found.status} /></div>
          </div>
          <BookingPlanner key={found.uid} student={found} staffMode initialSelection={pre} />
        </>
      )}
    </>
  );
}
