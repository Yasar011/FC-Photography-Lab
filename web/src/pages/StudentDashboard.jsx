import { Link } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { useNow } from '../lib/hooks.js';
import { useMyBookings, useMyFcApprovals, useMyWatches, isUpcoming } from '../lib/bookings.js';
import { call } from '../firebase.js';
import { StatusBadge, Alert, useToast } from '../components/ui.jsx';
import { nextSpecialStep } from '../components/BookingBits.jsx';
import Icon from '../components/Icon.jsx';
import { shortRange, istParts, dayOfWeek, DAY_NAMES, bookingWindow, datesBetween, addDays, todayIST, SLOT } from '@shared/calendar.js';
import { useSlotRange, daySlots } from '../components/Calendar.jsx';
import { activeBookingBlock, blockText } from '@shared/defaults.js';
import { ACCOUNT_STATUS, FC_APPROVAL_STATE } from '@shared/constants.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  const cancelBlock = activeBookingBlock(profile, now);

  return (
    <div className="stack-lg student-home">
      <div className="hello">
        <h1>{greet}, {firstName}</h1>
        <p className="muted">{profile.niftId} · {profile.department} · Semester {profile.semester}</p>
      </div>

      {!active && (
        <Alert kind="error">
          {profile.status === ACCOUNT_STATUS.GRADUATED
            ? 'Your account is marked Graduated. Booking access is disabled; your booking history is kept below.'
            : 'Your account is disabled. Please contact the FC Staff.'}
        </Alert>
      )}
      {active && Number(profile.semester) <= rules.firstYearMaxSemester && <Alert kind="warn">{rules.firstYearMessage}</Alert>}

      {actionNeeded.map((b) => {
        const step = nextSpecialStep(b);
        return (
          <Link key={b.id} to={`/bookings/${b.id}`} className="card card-pad row-between" style={{ textDecoration: 'none', color: 'var(--ink)', background: 'var(--yellow-bg)', border: 'none' }}>
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <Icon name="stamp" />
              <span>
                <b>Action needed for {b.id}:</b> {step.key === 'fcAssistant' ? step.todo : 'Take the printed form for signatures, then return it to the FC-CC'}.
                <div className="small muted">{DAY_NAMES[dayOfWeek(b.date)]} {Number(b.date.slice(8))} {MONTHS[Number(b.date.slice(5, 7)) - 1]} · {shortRange(b.startHour, b.endHour)}</div>
              </span>
            </span>
            <span className="btn btn-sm">Track</span>
          </Link>
        );
      })}

      {profile.idmRequest?.state === 'PENDING' && (
        <Alert kind="info">Your <b>FC-IDM</b> request is waiting for FC staff confirmation. Until then you book as an other-department student.</Alert>
      )}
      {active && cancelBlock && (
        <Alert kind="error">
          <span><b>{blockText(cancelBlock)}</b> Your other bookings are not affected.</span>
        </Alert>
      )}
      <div className="home-grid">
        <div className="stack">
          {active && !cancelBlock && <QuickBook />}
          {active && !cancelBlock && (
            <Link to="/book" className="btn btn-primary btn-block btn-lg"><Icon name="plus" /> Book the lab</Link>
          )}
          <SlotAlerts uid={user.uid} />
          <div className="home-links">
            {(isFcStudent || approvals.length > 0) && (
              <Link to="/approvals" className={`home-link ${pendingApprovals.length ? 'hot' : ''}`}>
                <span className="home-link-icon"><Icon name="checkCircle" /></span>
                <span className="grow"><b>My FC approvals</b><span className="small muted">{pendingApprovals.length ? `${pendingApprovals.length} request${pendingApprovals.length > 1 ? 's' : ''} waiting for you — tap to review` : 'Nothing waiting'}</span></span>
                <Icon name="chevronRight" />
              </Link>
            )}
            <Link to="/book" className="home-link">
              <span className="home-link-icon"><Icon name="calendar" /></span>
              <span className="grow"><b>Lab calendar</b><span className="small muted">Live · next {rules.bookingWindowDays} days</span></span>
              <Icon name="chevronRight" />
            </Link>
          </div>
        </div>

        <section>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2>My bookings</h2>
            <Link className="small" to="/my-bookings">See all ({items.length})</Link>
          </div>
          {loading ? <p className="muted small">Loading…</p> : upcoming.length === 0 ? (
            <div className="bk-empty">Nothing booked yet. <Link to="/book">Find a free slot →</Link></div>
          ) : (
            <div className="bk-list">
              {upcoming.map((b) => <BookingCard key={b.id} b={b} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Hours the student asked to be emailed about if they free up. */
function SlotAlerts({ uid }) {
  const toast = useToast();
  const now = useNow(60000);
  const today = todayIST(now);
  const list = Object.values(useMyWatches(uid)).filter((w) => w.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
  if (!list.length) return null;
  const remove = async (w) => {
    try {
      await call('watchSlot', { date: w.date, hours: [w.hour], on: false });
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <section className="card card-pad">
      <h2>Slot alerts</h2>
      <div className="small muted">We'll email you if one of these frees up.</div>
      <div className="watch-list">
        {list.map((w) => (
          <span key={w.date + w.hour} className="watch-chip">
            <Icon name="bell" />
            {DAY_NAMES[dayOfWeek(w.date)]} {Number(w.date.slice(8))} {MONTHS[Number(w.date.slice(5, 7)) - 1]} · {shortRange(w.hour, w.hour + 1)}
            <button onClick={() => remove(w)} aria-label="Remove alert"><Icon name="close" /></button>
          </span>
        ))}
      </div>
    </section>
  );
}

/** A booking as a rounded card: date block, purpose, time and a status pill. */
export function BookingCard({ b }) {
  return (
    <Link to={`/bookings/${b.id}`} className="bk-card">
      <span className="bk-date">
        <span>{DAY_NAMES[dayOfWeek(b.date)]}</span>
        <b>{Number(b.date.slice(8))}</b>
        <span>{MONTHS[Number(b.date.slice(5, 7)) - 1]}</span>
      </span>
      <span className="grow">
        <span className="bk-title">{b.purpose || 'Lab booking'}</span>
        <span className="small muted">{shortRange(b.startHour, b.endHour)} · <span className="mono">{b.id}</span></span>
      </span>
      <StatusBadge status={b.status} />
    </Link>
  );
}

/** One-tap booking: the next free regular-hours slots. */
function QuickBook() {
  const { user, rules, settings } = useAuth();
  const now = useNow(60000);
  const win = bookingWindow(rules, now);
  const { slots, loading } = useSlotRange(win.from, win.to);
  const today = todayIST(now);
  const picks = [];
  for (const d of datesBetween(win.from, win.to)) {
    for (const s of daySlots({ date: d, rules, settings, slots, nowMs: now, viewerUid: user.uid })) {
      if (s.state === SLOT.AVAILABLE || s.state === SLOT.OVERRIDE_OPEN) picks.push(s);
      if (picks.length >= 6) break;
    }
    if (picks.length >= 6) break;
  }
  const dayLabel = (d) => (d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : `${DAY_NAMES[dayOfWeek(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`);
  return (
    <section className="card card-pad">
      <div className="row-between" style={{ marginBottom: 10 }}>
        <h2>Next free slots</h2>
        <span className="live-dot">Live</span>
      </div>
      {loading ? <p className="small muted">Checking live availability…</p> : picks.length === 0 ? (
        <p className="small muted">No free regular slots this week. <Link to="/book">See all times</Link> (night hours 10 PM – 9 AM and weekends need special approval).</p>
      ) : (
        <div className="quick-chips">
          {picks.map((s) => (
            <Link key={s.date + s.hour} className="quick-chip" to={`/book?date=${s.date}&start=${s.hour}&end=${s.hour + 1}`}>
              <span className="d">{dayLabel(s.date)}</span>
              <span className="t">{shortRange(s.hour, s.hour + 1)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
