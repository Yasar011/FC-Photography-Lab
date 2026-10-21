import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { useMyBookings, isUpcoming } from '../lib/bookings.js';
import { PageHead } from '../components/ui.jsx';
import { BookingCard } from './StudentDashboard.jsx';

export default function MyBookings() {
  const { user } = useAuth();
  const { items, loading } = useMyBookings(user.uid);
  const [tab, setTab] = useState('upcoming');
  const shown = tab === 'upcoming' ? items.filter((b) => isUpcoming(b)).reverse() : items.filter((b) => !isUpcoming(b));

  return (
    <div className="student-home">
      <PageHead title="My bookings">
        <Link className="btn btn-primary" to="/book">+ New booking</Link>
      </PageHead>
      <div className="seg seg-wide" role="tablist" style={{ marginBottom: 14 }}>
        <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>Upcoming & pending</button>
        <button className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>Past & closed</button>
      </div>
      {loading ? (
        <p className="muted small">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="bk-empty">{tab === 'upcoming' ? <>No upcoming bookings. <Link to="/book">Find a free slot →</Link></> : 'No past bookings.'}</div>
      ) : (
        <div className="bk-list">
          {shown.map((b) => <BookingCard key={b.id} b={b} />)}
        </div>
      )}
    </div>
  );
}
