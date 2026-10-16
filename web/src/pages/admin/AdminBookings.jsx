import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { orderByChild, startAt, endAt } from 'firebase/database';

import { useLive, dbQuery } from '../../lib/hooks.js';
import { PageHead, StatusBadge, Empty, TypeBadge } from '../../components/ui.jsx';
import { STATUS_META } from '@shared/constants.js';
import { todayIST, addDays, formatDate, formatRange } from '@shared/calendar.js';

export default function AdminBookings() {
  const [params, setParams] = useSearchParams();
  const today = todayIST();
  const [from, setFrom] = useState(params.get('from') || addDays(today, -30));
  const [to, setTo] = useState(params.get('to') || addDays(today, 30));
  const status = params.get('status') || '';
  const [text, setText] = useState('');
  const navigate = useNavigate();

  const q = useMemo(() => dbQuery('bookings', orderByChild('date'), startAt(from), endAt(to)), [from, to]);
  const { value, loading } = useLive(q, [q]);
  const items = Object.values(value || {})
    .filter((b) => !status || b.status === status)
    .filter((b) => {
      if (!text.trim()) return true;
      const t = text.trim().toLowerCase();
      return [b.id, b.studentName, b.niftId, b.purpose, b.department, b.fcStudent?.name].some((v) => String(v || '').toLowerCase().includes(t));
    })
    .sort((a, b) => b.startAt - a.startAt);

  const setStatus = (s) => {
    const p = new URLSearchParams(params);
    if (s) p.set('status', s);
    else p.delete('status');
    setParams(p, { replace: true });
  };

  return (
    <>
      <PageHead eyebrow="Bookings" title="All bookings" sub={`${items.length} booking${items.length === 1 ? '' : 's'} shown`}>
        <span className="live-dot">Live</span>
      </PageHead>
      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="grid grid-4">
          <label className="field"><span className="label">From</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span className="label">To</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="field">
            <span className="label">Status</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Search</span><input className="input" placeholder="ID, name, NIFT ID, purpose…" value={text} onChange={(e) => setText(e.target.value)} /></label>
        </div>
      </section>
      <section className="card">
        {loading ? <div className="card-body muted">Loading…</div> : items.length === 0 ? <Empty title="No bookings match" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Booking ID</th><th>Date</th><th>Time</th><th>Student</th><th>Type</th><th>Purpose</th><th>Booked by</th><th>Status</th></tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id} className="click" onClick={() => navigate(`/bookings/${b.id}`)}>
                    <td className="booking-id">{b.id}</td>
                    <td className="nowrap">{formatDate(b.date, { weekday: true })}</td>
                    <td className="nowrap mono small">{formatRange(b.startHour, b.endHour)}</td>
                    <td><div style={{ fontWeight: 600 }}>{b.studentName}</div><div className="small muted mono">{b.niftId} · {b.department} {b.semester}</div></td>
                    <td><TypeBadge type={b.studentType} /></td>
                    <td className="small">{b.purpose}</td>
                    <td className="small">{b.bookedByStaff ? `Staff Admin (${b.createdBy?.name})` : 'Student'}</td>
                    <td><StatusBadge status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
