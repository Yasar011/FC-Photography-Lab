import { Link } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { useNow } from '../lib/hooks.js';
import { useMyBookings, useMyFcApprovals, isUpcoming } from '../lib/bookings.js';
import { StatusBadge, Alert, Empty } from '../components/ui.jsx';
import { nextSpecialStep } from '../components/BookingBits.jsx';
import Icon from '../components/Icon.jsx';
import { formatRange, istParts, dayOfWeek, DAY_NAMES } from '@shared/calendar.js';
import { ACCOUNT_STATUS, FC_APPROVAL_STATE, STATUS_META } from '@shared/constants.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR = { green: 'var(--ev-approved)', orange: 'var(--ev-pending)', yellow: 'var(--ev-pending)' };

export default function StudentDashboard() {
  const { user, profile, isFcStudent, rules } = useAuth();
  const now = useNow(60000);
  const { items, loading } = useMyBookings(user.uid);
  const { items: approvals } = useMyFcApprovals(user.uid);
  const upcoming = items.filter((b) => isUpcoming(b, now)).sort((a, b) => a.startAt - b.startAt);
  const pendingApprovals = approvals.filter((a) => a.state === FC_APPROVAL_STATE.PENDING);
  // Prompt only when the student must do something (FC-CC signing is not a student step).
  const actionNeeded = upcoming.filter((b) => nextSpecialStep(b));
  const firstName = (profile.name || '').split(' ')[0];
  const hour = istParts(now).hour;
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const active = profile.status === ACCOUNT_STATUS.ACTIVE;

  return (
    <div className="stack-lg" style={{ maxWidth: 1080 }}>
      <div>
        <h1 style={{ fontWeight: 500, fontSize: 28 }}>{greet}, {firstName}</h1>
        <p className="muted" style={{ marginTop: 4 }}>{profile.niftId} · {profile.department} · Semester {profile.semester}</p>
      </div>

      {!active && (
        <Alert kind="error">
          {profile.status === ACCOUNT_STATUS.GRADUATED
            ? 'Your account is marked Graduated. Booking access is disabled; your booking history is kept below.'
            : 'Your account is disabled. Please contact the FC Staff.'}
        </Alert>
      )}
      {active && Number(profile.semester) <= rules.firstYearMaxSemester && <Alert kind="warn">{rules.firstYearMessage}</Alert>}

      {pendingApprovals.length > 0 && (
        <Link to="/approvals" className="card card-pad row-between" style={{ textDecoration: 'none', color: 'var(--ink)', background: 'var(--orange-bg)', border: 'none' }}>
          <span className="row"><Icon name="checkCircle" /> <b>{pendingApprovals.length} FC approval request{pendingApprovals.length > 1 ? 's' : ''}</b> waiting for you</span>
          <span className="btn btn-sm">Review</span>
        </Link>
      )}
      {actionNeeded.map((b) => {
        const step = nextSpecialStep(b);
        return (
          <Link key={b.id} to={`/bookings/${b.id}`} className="card card-pad row-between" style={{ textDecoration: 'none', color: 'var(--ink)', background: 'var(--yellow-bg)', border: 'none' }}>
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <Icon name="stamp" />
              <span>
                <b>Action needed for {b.id}:</b> {step.key === 'fcAssistant' ? step.todo : 'Take the printed form for signatures, then return it to the FC-CC'}.
                <div className="small muted">{DAY_NAMES[dayOfWeek(b.date)]} {Number(b.date.slice(8))} {MONTHS[Number(b.date.slice(5, 7)) - 1]} · {formatRange(b.startHour, b.endHour)}</div>
              </span>
            </span>
            <span className="btn btn-sm">Track</span>
          </Link>
        );
      })}

      <div className="grid grid-4">
        <Link to="/book" className="tile primary">
          <span className="tile-icon"><Icon name="plus" /></span>
          <span className="tile-t">Book the lab</span>
          <span className="tile-d">Live calendar · next {rules.bookingWindowDays} days</span>
        </Link>
        <Link to="/my-bookings" className="tile">
          <span className="tile-icon"><Icon name="list" /></span>
          <span className="tile-t">My bookings</span>
          <span className="tile-d">{upcoming.length} upcoming · {items.length} total</span>
        </Link>
        {(isFcStudent || approvals.length > 0) && (
          <Link to="/approvals" className="tile">
            <span className="tile-icon"><Icon name="checkCircle" /></span>
            <span className="tile-t">My FC approvals</span>
            <span className="tile-d">{pendingApprovals.length} pending</span>
          </Link>
        )}
        <Link to="/profile" className="tile">
          <span className="tile-icon"><Icon name="user" /></span>
          <span className="tile-t">Profile</span>
          <span className="tile-d">{profile.email}</span>
        </Link>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Upcoming</h2>
          <span className="live-dot">Live</span>
        </div>
        {loading ? <div className="card-body muted">Loading…</div> : upcoming.length === 0 ? (
          <Empty title="Nothing booked yet"><Link to="/book">Find a free slot →</Link></Empty>
        ) : upcoming.map((b) => (
          <Link key={b.id} to={`/bookings/${b.id}`} className="list-item" style={{ justifyContent: 'flex-start', flexWrap: 'nowrap' }}>
            <div className="agenda-date">
              <div className="m">{DAY_NAMES[dayOfWeek(b.date)]}</div>
              <div className="d">{Number(b.date.slice(8))}</div>
              <div className="m">{MONTHS[Number(b.date.slice(5, 7)) - 1]}</div>
            </div>
            <span className="agenda-bar" style={{ background: BAR[STATUS_META[b.status]?.tone] || 'var(--ev-booked)' }} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{b.purpose}</div>
              <div className="small muted">{formatRange(b.startHour, b.endHour)} · <span className="mono">{b.id}</span></div>
            </div>
            <StatusBadge status={b.status} />
          </Link>
        ))}
      </section>
    </div>
  );
}
