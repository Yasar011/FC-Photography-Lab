import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { useMyBookings, isUpcoming } from '../lib/bookings.js';
import { PageHead, StatusBadge, Empty } from '../components/ui.jsx';
import { formatDate, formatRange } from '@shared/calendar.js';

export default function MyBookings() {
  const { user } = useAuth();
  const { items, loading } = useMyBookings(user.uid);
  const [tab, setTab] = useState('upcoming');
  const navigate = useNavigate();
  const shown = tab === 'upcoming' ? items.filter((b) => isUpcoming(b)).reverse() : items.filter((b) => !isUpcoming(b));

  return (
    <>
      <PageHead eyebrow="Bookings" title="My Bookings">
        <Link className="btn btn-primary" to="/book">+ New booking</Link>
      </PageHead>
      <div className="tabs" role="tablist">
        <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>Upcoming & pending</button>
        <button className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>Past & closed</button>
      </div>
      <section className="card">
        {loading ? (
          <div className="card-body muted">Loading…</div>
        ) : shown.length === 0 ? (
          <Empty title={tab === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Booking ID</th><th>Date</th><th>Time</th><th>Purpose</th><th>Status</th></tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} className="click" onClick={() => navigate(`/bookings/${b.id}`)}>
                    <td className="booking-id">{b.id}</td>
                    <td className="nowrap">{formatDate(b.date, { weekday: true })}</td>
                    <td className="nowrap mono small">{formatRange(b.startHour, b.endHour)}</td>
                    <td>{b.purpose}</td>
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
