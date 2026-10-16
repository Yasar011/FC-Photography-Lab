import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { orderByChild, startAt, endAt } from 'firebase/database';

import { useAuth } from '../lib/auth.jsx';
import { useLive, dbQuery, useNow } from '../lib/hooks.js';
import { useMyBookings, isUpcoming } from '../lib/bookings.js';
import { STATUS_META, ACCOUNT_STATUS } from '@shared/constants.js';
import { bookingWindow, datesBetween, addDays, formatDate, formatRange, BOOKABLE_STATES, todayIST } from '@shared/calendar.js';

import { useSlotRange, daySlots } from './Calendar.jsx';
import { maxHoursFor } from '@shared/defaults.js';
import TimeGrid from './cal/TimeGrid.jsx';
import MiniMonth from './cal/MiniMonth.jsx';
import { Popover } from './cal/Overlays.jsx';
import BookingForm from './BookingForm.jsx';
import Icon, { PlusColor } from './Icon.jsx';
import { Alert, StatusBadge } from './ui.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function rangeTitle(dates) {
  const a = dates[0];
  const b = dates[dates.length - 1];
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  if (a === b) return `${ad} ${MONTHS[am - 1]} ${ay}`;
  if (am === bm) return `${ad} – ${bd} ${MONTHS[am - 1]} ${ay}`;
  return `${ad} ${MONTHS[am - 1]} – ${bd} ${MONTHS[bm - 1]} ${by}`;
}

export function useNarrow(px = 760) {
  const q = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return narrow;
}

export function CalendarLegend({ staff }) {
  const items = [
    ['var(--surface)', '1px solid var(--line-2)', 'Available — click or drag to book'],
    ['var(--ev-special-bg)', '1px solid var(--yellow-line)', 'Special approval hours'],
    ['transparent', '1.5px dashed var(--ev-override)', 'Opened by FC Staff'],
    [staff ? 'var(--ev-approved)' : 'var(--ev-mine)', 'none', staff ? 'Approved booking' : 'Your booking'],
    ['#fff3e6', '1.5px solid var(--ev-pending)', 'Pending approval'],
    ['var(--ev-booked)', 'none', 'Booked'],
    ['var(--ev-class-bg)', '1px solid #c3c8cf', 'CLS class hours'],
    ['repeating-linear-gradient(45deg,#6b6f74 0 3px,#55595e 3px 6px)', 'none', 'Blocked'],
    ['#fdf0ee', '1px solid var(--red-line)', 'Holiday'],
  ];
  return (
    <div className="legend">
      {items.map(([bg, border, label]) => (
        <span key={label}><i style={{ background: bg, border }} />{label}</span>
      ))}
    </div>
  );
}

/**
 * Calendar-first booking: Google-Calendar-like week/day grid. Pick a time by
 * clicking or dragging; the booking form opens in a side panel.
 */
export default function BookingPlanner({ student, staffMode = false, initialSelection = null }) {
  const { user, rules, settings } = useAuth();
  const now = useNow(30000);
  const narrow = useNarrow();
  const today = todayIST(now);
  const win = bookingWindow(rules, now, staffMode);
  const windowDates = useMemo(() => datesBetween(win.from, win.to), [win.from, win.to]);

  const [view, setView] = useState(narrow ? 'day' : 'week');
  const [anchor, setAnchor] = useState(initialSelection?.date || today);
  const [month, setMonth] = useState((initialSelection?.date || today).slice(0, 7));
  const [selection, setSelection] = useState(initialSelection);
  const [formOpen, setFormOpen] = useState(Boolean(initialSelection));
  const [pop, setPop] = useState(null);
  useEffect(() => setView(narrow ? 'day' : 'week'), [narrow]);

  // Visible dates: day view = anchor; week view = 7 window days containing anchor.
  const idx = Math.max(0, windowDates.indexOf(anchor));
  const pageStart = Math.floor(idx / 7) * 7;
  const dates = view === 'day' ? [windowDates.includes(anchor) ? anchor : windowDates[0]] : windowDates.slice(pageStart, pageStart + 7);

  const { slots } = useSlotRange(win.from, win.to);
  const slotArgs = { rules, settings, slots, nowMs: now, viewerUid: staffMode ? student.uid : user.uid, staffView: staffMode, ignoreWindow: true };
  const slotsByDate = {};
  for (const d of windowDates) slotsByDate[d] = daySlots({ ...slotArgs, date: d });
  const freeCount = {};
  for (const d of dates) freeCount[d] = slotsByDate[d].filter((s) => BOOKABLE_STATES.includes(s.state)).length;

  // Labels for events: own bookings (student) or everyone's (staff).
  const { items: mine } = useMyBookings(staffMode ? null : user.uid);
  const mineMap = Object.fromEntries(mine.map((b) => [b.id, b]));
  const bq = useMemo(() => (staffMode ? dbQuery('bookings', orderByChild('date'), startAt(win.from), endAt(win.to)) : null), [staffMode, win.from, win.to]);
  const { value: allMap } = useLive(bq, [bq]);
  const bookingInfo = (id) => (staffMode ? allMap?.[id] : mineMap[id]);

  const describe = (s) => {
    const b = bookingInfo(s.bookingId);
    if (staffMode) return { title: b?.studentName || 'Booked', sub: STATUS_META[s.status]?.label };
    if (b) return { title: b.purpose || 'Your booking', sub: STATUS_META[s.status]?.label };
    return { title: s.state === 'PENDING' ? 'Pending booking' : 'Booked', sub: '' };
  };

  const canSelect = (s) => BOOKABLE_STATES.includes(s.state);
  const inactive = student.status !== ACCOUNT_STATUS.ACTIVE || student.bookingAccess === false;
  const maxH = maxHoursFor(rules, student.studentType); // FC students 4 h, others 3 h

  const firstFree = () => {
    for (const d of windowDates) {
      const s = slotsByDate[d].find(canSelect);
      if (s) return { date: d, start: s.hour, end: s.hour + 1 };
    }
    return null;
  };
  const openForm = (sel) => {
    if (inactive) return;
    const pick = sel || selection || firstFree();
    if (!pick) return;
    setSelection(pick);
    setAnchor(pick.date);
    setFormOpen(true);
  };

  const step = (dir) => {
    const target = view === 'day' ? addDays(dates[0], dir) : addDays(dates[0], dir * 7);
    if (target < win.from) setAnchor(win.from);
    else if (target > win.to) setAnchor(win.to);
    else setAnchor(target);
  };
  const canBack = dates[0] > win.from;
  const canFwd = dates[dates.length - 1] < win.to;

  const upcoming = mine.filter((b) => isUpcoming(b, now)).sort((a, b) => a.startAt - b.startAt).slice(0, 4);
  const popBooking = pop && bookingInfo(pop.id);
  const popSlots = pop ? Object.values(slotsByDate).flat().filter((s) => s.bookingId === pop.id) : [];
  const popSlot = popSlots[0];
  const popRange = popSlot ? [Math.min(...popSlots.map((s) => s.hour)), Math.max(...popSlots.map((s) => s.hour)) + 1] : null;

  return (
    <div className="cal-layout">
      <aside className="cal-side">
        <button className="create-btn" style={{ margin: 0 }} onClick={() => openForm(null)} disabled={inactive}>
          <PlusColor /> {staffMode ? 'New booking' : 'Book a slot'}
        </button>
        <MiniMonth
          month={month}
          onMonth={setMonth}
          selected={view === 'day' ? dates[0] : null}
          highlight={view === 'week' ? dates : []}
          isEnabled={(d) => d >= win.from && d <= win.to}
          marks={new Set(mine.filter((b) => isUpcoming(b, now)).map((b) => b.date))}
          holidays={settings.holidays || {}}
          onSelect={(d) => { setAnchor(d); if (narrow) setView('day'); }}
        />
        {!staffMode && (
          <div className="hide-narrow">
            <div className="label" style={{ marginBottom: 8 }}>Your upcoming</div>
            {upcoming.length === 0 ? <p className="small muted">No upcoming bookings.</p> : upcoming.map((b) => (
              <Link key={b.id} to={`/bookings/${b.id}`} className="row" style={{ gap: 10, padding: '6px 0', color: 'var(--ink)', textDecoration: 'none', flexWrap: 'nowrap' }}>
                <span className="agenda-bar" style={{ background: STATUS_META[b.status]?.tone === 'green' ? 'var(--ev-approved)' : 'var(--ev-pending)' }} />
                <span className="grow">
                  <div className="small" style={{ fontWeight: 600 }}>{formatDate(b.date, { weekday: true })}</div>
                  <div className="tiny muted">{formatRange(b.startHour, b.endHour)} · {STATUS_META[b.status]?.label}</div>
                </span>
              </Link>
            ))}
          </div>
        )}
        <div className="legend-box">
          <div className="label" style={{ marginBottom: 10 }}>Legend</div>
          <CalendarLegend staff={staffMode} />
        </div>
      </aside>

      <section style={{ minWidth: 0 }}>
        {inactive && (
          <div style={{ marginBottom: 12 }}>
            <Alert kind="error">
              {student.status === ACCOUNT_STATUS.GRADUATED
                ? 'Graduated students cannot create new bookings. Your previous bookings remain in My bookings.'
                : 'Booking access is disabled for this account. Please contact the FC Staff.'}
            </Alert>
          </div>
        )}
        <div className="cal-toolbar">
          <button className="btn btn-sm" onClick={() => setAnchor(today)}>Today</button>
          <button className="icon-btn" onClick={() => step(-1)} disabled={!canBack} aria-label="Previous"><Icon name="chevronLeft" /></button>
          <button className="icon-btn" onClick={() => step(1)} disabled={!canFwd} aria-label="Next"><Icon name="chevronRight" /></button>
          <span className="title">{rangeTitle(dates)}</span>
          <span className="live-dot">Live</span>
          <span className="grow" />
          <div className="seg" role="group" aria-label="View">
            <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Day</button>
            <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Week</button>
          </div>
        </div>
        <p className="small muted" style={{ margin: '-6px 0 10px' }}>
          {staffMode
            ? `Booking for ${student.name} · up to ${rules.staffBookingWindowDays} days ahead · max ${maxH} h`
            : `Click a free slot (or drag to select up to ${maxH} hours). Bookings open ${rules.bookingWindowDays} days ahead.`}
        </p>
        <TimeGrid
          dates={dates}
          rules={rules}
          slotsByDate={slotsByDate}
          nowMs={now}
          selection={formOpen ? selection : null}
          onSelect={inactive ? undefined : (sel) => openForm(sel)}
          canSelect={canSelect}
          maxSelect={maxH}
          describe={describe}
          onEventClick={(id, rect) => setPop({ id, rect })}
          holidays={settings.holidays || {}}
          onDayClick={(d) => { setAnchor(d); setView('day'); }}
          freeCount={freeCount}
          scrollToHour={Math.max(rules.gridStartHour, Math.min(16, rules.regularStartHour - 1))}
        />
      </section>

      {formOpen && selection && (
        <BookingForm
          key={staffMode ? student.uid : 'self'}
          student={student}
          staffMode={staffMode}
          selection={selection}
          onSelection={(s) => { setSelection(s); setAnchor(s.date); }}
          dates={windowDates}
          slotsByDate={slotsByDate}
          onClose={() => { setFormOpen(false); setSelection(null); }}
        />
      )}

      {pop && (
        <Popover anchor={pop.rect} onClose={() => setPop(null)}>
          <div className="ev-title">
            <span className="ev-swatch" style={{ background: popSlot?.state === 'PENDING' || STATUS_META[popSlot?.status]?.tone === 'orange' ? 'var(--ev-pending)' : popBooking ? 'var(--ev-mine)' : 'var(--ev-booked)' }} />
            <div>
              <div className="ev-name">{popBooking ? (staffMode ? popBooking.studentName : popBooking.purpose) : 'Booked'}</div>
              {popSlot && <div className="small muted">{formatDate(popSlot.date, { weekday: true })} · {formatRange(...popRange)}</div>}
            </div>
          </div>
          {popSlot && <div className="ev-line"><Icon name="info" /><StatusBadge status={popSlot.status} /></div>}
          {popBooking ? (
            <>
              <div className="ev-line"><Icon name="camera" /><span>{(popBooking.equipmentList || []).join(', ')}</span></div>
              {staffMode && <div className="ev-line"><Icon name="user" /><span>{popBooking.niftId} · {popBooking.department} {popBooking.semester}</span></div>}
              <div className="ev-line"><Icon name="flag" /><span className="mono">{popBooking.id}</span></div>
              <div className="ev-actions"><Link className="btn btn-tonal btn-sm" to={`/bookings/${popBooking.id}`}>Open booking</Link></div>
            </>
          ) : (
            <div className="ev-line"><Icon name="lock" /><span>This time is taken by another booking.</span></div>
          )}
        </Popover>
      )}
    </div>
  );
}
