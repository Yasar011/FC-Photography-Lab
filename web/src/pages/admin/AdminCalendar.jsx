import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { orderByChild, startAt, endAt } from 'firebase/database';

import { useAuth } from '../../lib/auth.jsx';
import { useLive, dbQuery, useNow } from '../../lib/hooks.js';
import { call } from '../../firebase.js';
import { Modal, Field, Alert, StatusBadge, useToast } from '../../components/ui.jsx';
import { useSlotRange, daySlots } from '../../components/Calendar.jsx';
import TimeGrid from '../../components/cal/TimeGrid.jsx';
import MiniMonth from '../../components/cal/MiniMonth.jsx';
import { Popover } from '../../components/cal/Overlays.jsx';
import { CalendarLegend, rangeTitle, useNarrow } from '../../components/BookingPlanner.jsx';
import Icon from '../../components/Icon.jsx';
import { STATUS_META, STUDENT_TYPE_LABELS } from '@shared/constants.js';
import { todayIST, addDays, startOfWeek, datesBetween, formatDate, formatRange, slotKey, SLOT } from '@shared/calendar.js';

export default function AdminCalendar() {
  const { rules, settings, isStaff } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow(30000);
  const narrow = useNarrow();
  const today = todayIST(now);
  const [view, setView] = useState(narrow ? 'day' : 'week');
  const [anchor, setAnchor] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [sel, setSel] = useState(null);
  const [pop, setPop] = useState(null);
  const [modal, setModal] = useState(null);

  const dates = view === 'day' ? [anchor] : datesBetween(startOfWeek(anchor), addDays(startOfWeek(anchor), 6));
  const from = dates[0];
  const to = dates[dates.length - 1];
  const { slots } = useSlotRange(from, to);
  const bq = useMemo(() => dbQuery('bookings', orderByChild('date'), startAt(from), endAt(to)), [from, to]);
  const { value: bookingsMap } = useLive(bq, [bq]);
  const bookings = bookingsMap || {};

  const slotsByDate = {};
  for (const d of dates) slotsByDate[d] = daySlots({ date: d, rules, settings, slots, nowMs: now, staffView: true, ignoreWindow: true });

  const describe = (s) => {
    const b = bookings[s.bookingId];
    return { title: b?.studentName || 'Booking', sub: b ? `${b.department} · ${STATUS_META[s.status]?.label}` : STATUS_META[s.status]?.label };
  };
  const canSelect = (s) => isStaff && s.state !== SLOT.PAST && !s.bookingId;
  const overrides = sel ? settings.availabilityOverrides?.[sel.date] || {} : {};
  const selHours = sel ? Array.from({ length: sel.end - sel.start }, (_, i) => sel.start + i) : [];
  const selHasOverride = selHours.some((h) => overrides[slotKey(h)]);
  const step = (dir) => setAnchor(addDays(anchor, dir * (view === 'day' ? 1 : 7)));
  const popB = pop && bookings[pop.id];

  const runCall = async (name, data, msg) => {
    await call(name, data);
    toast(msg, 'ok');
  };

  return (
    <div className="cal-layout">
      <aside className="cal-side">
        {isStaff && (
          <Link to="/admin/book" className="create-btn" style={{ margin: 0 }}>
            <Icon name="plus" className="plus" /> Book for student
          </Link>
        )}
        <MiniMonth
          month={month}
          onMonth={setMonth}
          selected={view === 'day' ? anchor : null}
          highlight={view === 'week' ? dates : []}
          holidays={settings.holidays || {}}
          onSelect={(d) => setAnchor(d)}
        />
        <div className="legend-box">
          <div className="label" style={{ marginBottom: 10 }}>Legend</div>
          <CalendarLegend staff />
        </div>
        {isStaff && (
          <p className="small muted hide-narrow">
            Tip: drag over class hours, evenings or weekends to <b>open</b>, <b>block</b> or create <b>special availability</b>. Click a holiday chip to open or close it.
          </p>
        )}
      </aside>

      <section style={{ minWidth: 0 }}>
        <div className="cal-toolbar">
          <button className="btn btn-sm" onClick={() => setAnchor(today)}>Today</button>
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous"><Icon name="chevronLeft" /></button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next"><Icon name="chevronRight" /></button>
          <span className="title">{rangeTitle(dates)}</span>
          <span className="live-dot">Live</span>
          <span className="grow" />
          <div className="seg" role="group" aria-label="View">
            <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Day</button>
            <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Week</button>
          </div>
        </div>
        <TimeGrid
          dates={dates}
          rules={rules}
          slotsByDate={slotsByDate}
          nowMs={now}
          selection={sel}
          onSelect={isStaff ? setSel : undefined}
          canSelect={canSelect}
          maxSelect={24}
          describe={describe}
          onEventClick={(id, rect) => setPop({ id, rect })}
          holidays={settings.holidays || {}}
          onHolidayClick={isStaff ? (d) => setModal({ type: settings.holidays[d]?.open ? 'holidayClose' : 'holidayOpen', date: d }) : undefined}
          onDayClick={(d) => { setAnchor(d); setView('day'); }}
          scrollToHour={rules.gridStartHour}
        />
      </section>

      {sel && (
        <div className="selbar" role="region" aria-label="Selected time">
          <div>
            <div className="t">{formatDate(sel.date, { weekday: true })}</div>
            <div className="s">{formatRange(sel.start, sel.end)} · {sel.end - sel.start} h</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={() => setModal({ type: 'open' })}><Icon name="open" /> Open</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setModal({ type: 'special' })}>Special</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setModal({ type: 'block' })}><Icon name="lock" /> Block</button>
            {selHasOverride && <button className="btn btn-sm btn-ghost" onClick={() => setModal({ type: 'remove' })}>Remove override</button>}
            {sel.end - sel.start <= Math.max(rules.fcMaxDurationHours, rules.maxDurationHours) && (
              <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/admin/book?date=${sel.date}&start=${sel.start}&end=${sel.end}`)}>Book for student</button>
            )}
            {!settings.holidays?.[sel.date] && <button className="btn btn-sm btn-ghost" onClick={() => setModal({ type: 'holidayAdd', date: sel.date })}>Holiday</button>}
            <button className="icon-btn" style={{ color: '#fff' }} onClick={() => setSel(null)} aria-label="Clear selection"><Icon name="close" /></button>
          </div>
        </div>
      )}

      {pop && popB && (
        <Popover anchor={pop.rect} onClose={() => setPop(null)}>
          <div className="ev-title">
            <span className="ev-swatch" style={{ background: STATUS_META[popB.status]?.tone === 'green' ? 'var(--ev-approved)' : STATUS_META[popB.status]?.tone === 'blue' ? 'var(--ev-booked)' : 'var(--ev-pending)' }} />
            <div>
              <div className="ev-name">{popB.studentName}</div>
              <div className="small muted">{formatDate(popB.date, { weekday: true })} · {formatRange(popB.startHour, popB.endHour)}</div>
            </div>
          </div>
          <div className="ev-line"><Icon name="info" /><StatusBadge status={popB.status} /></div>
          <div className="ev-line"><Icon name="user" /><span>{popB.niftId} · {popB.department} {popB.semester} · {STUDENT_TYPE_LABELS[popB.studentType]}</span></div>
          <div className="ev-line"><Icon name="list" /><span>{popB.purpose}</span></div>
          <div className="ev-line"><Icon name="camera" /><span>{(popB.equipmentList || []).join(', ')}</span></div>
          {popB.fcStudent && <div className="ev-line"><Icon name="checkCircle" /><span>FC: {popB.fcStudent.name}</span></div>}
          <div className="ev-line"><Icon name="flag" /><span className="mono">{popB.id}</span>{popB.bookedByStaff && <span className="badge plain tone-violet">Staff booking</span>}</div>
          <div className="ev-actions">
            <Link className="btn btn-tonal btn-sm" to={`/bookings/${popB.id}`}>Open booking</Link>
            <Link className="btn btn-sm" to={`/print/${popB.id}`}><Icon name="print" /> {popB.isSpecial ? 'Form' : 'Slip (optional)'}</Link>
          </div>
        </Popover>
      )}

      {modal && (
        <OverrideModal
          kind={modal.type}
          date={modal.date || sel?.date}
          hours={selHours}
          holiday={settings.holidays?.[modal.date || sel?.date]}
          onClose={() => setModal(null)}
          onRun={runCall}
          afterDone={() => setSel(null)}
        />
      )}
    </div>
  );
}

function OverrideModal({ kind, date, hours, holiday, onClose, onRun, afterDone }) {
  const [reason, setReason] = useState('');
  const [name, setName] = useState(holiday?.name || '');
  const [requiresSpecial, setRequiresSpecial] = useState(kind === 'special');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const range = hours.length ? formatRange(hours[0], hours[hours.length - 1] + 1) : '';

  const conf = {
    open: { title: 'Open this slot', btn: 'OPEN THIS SLOT', tone: 'primary', need: true, run: () => onRun('setSlotOverride', { date, hours, type: 'open', kind: 'slot', reason, requiresSpecial }, 'Opened — AVAILABLE (Admin Override)') },
    special: { title: 'Special availability', btn: 'Create availability', tone: 'primary', need: true, run: () => onRun('setSlotOverride', { date, hours, type: 'open', kind: 'special', reason, requiresSpecial }, 'Special availability created') },
    block: { title: 'Block slot', btn: 'Block', tone: 'danger', need: true, run: () => onRun('setSlotOverride', { date, hours, type: 'block', reason }, 'Slot blocked') },
    remove: { title: 'Remove override', btn: 'Remove', tone: 'danger', need: false, run: () => onRun('removeSlotOverride', { date, hours, reason }, 'Override removed') },
    holidayAdd: { title: 'Mark as public holiday', btn: 'Save holiday', tone: 'primary', need: false, run: () => onRun('setHoliday', { date, name, open: false, remarks: reason }, 'Holiday added') },
    holidayOpen: { title: 'Open holiday for booking', btn: 'OPEN FOR BOOKING', tone: 'green', need: false, run: () => onRun('setHoliday', { date, name, open: true, requiresSpecial, remarks: reason }, 'Holiday opened for booking') },
    holidayClose: { title: 'Close holiday', btn: 'Close date', tone: 'danger', need: false, run: () => onRun('setHoliday', { date, name, open: false, remarks: reason }, 'Holiday closed') },
  }[kind];

  const submit = async () => {
    if (conf.need && !reason.trim()) return setError('Reason / remarks is required.');
    setBusy(true);
    setError('');
    try {
      await conf.run();
      afterDone();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const isHoliday = kind.startsWith('holiday');
  return (
    <Modal
      title={conf.title}
      onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className={`btn btn-${conf.tone}`} onClick={submit} disabled={busy}>{busy ? 'Saving…' : conf.btn}</button></>}
    >
      <div className="slot-sum">
        <Icon name={isHoliday ? 'sun' : 'clock'} />
        <div><div className="big">{formatDate(date, { weekday: true })}</div>{!isHoliday && <div className="small muted">{range}</div>}</div>
      </div>
      {kind === 'open' && <p className="small muted">Students will see these slots as <b>AVAILABLE — ADMIN OVERRIDE</b>. Existing bookings are never affected.</p>}
      {kind === 'block' && <p className="small muted">Blocking is refused for any slot that already has an active booking.</p>}
      {kind === 'holidayClose' && <p className="small muted">A date can only be closed when no active booking exists on it.</p>}
      {isHoliday && <Field label="Holiday name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" /></Field>}
      {(kind === 'open' || kind === 'special' || kind === 'holidayOpen') && (
        <label className="check">
          <input type="checkbox" checked={requiresSpecial} onChange={(e) => setRequiresSpecial(e.target.checked)} />
          Bookings {isHoliday ? 'on this date' : 'in these slots'} still need the special approval workflow
        </label>
      )}
      <Field label={conf.need ? 'Reason / remarks' : 'Remarks'} required={conf.need}>
        <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
      </Field>
      <Alert kind="error">{error}</Alert>
    </Modal>
  );
}

