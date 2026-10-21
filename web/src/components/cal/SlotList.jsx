import { useEffect, useRef, useState } from 'react';

import Icon from '../Icon.jsx';

import { SLOT, BOOKABLE_STATES, dayOfWeek, DAY_NAMES, shortHour, shortRange } from '@shared/calendar.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// What each slot shows on the phone list: [text, pill label, pill tone].
function slotLook(s) {
  switch (s.state) {
    case SLOT.AVAILABLE: return ['Available', 'Free', 'ok'];
    case SLOT.OVERRIDE_OPEN: return ['Opened by FC Staff', 'Free', 'ok'];
    case SLOT.SPECIAL: return ['Special approval', 'Special', 'wait'];
    case SLOT.MINE: return ['Your booking', 'Yours', 'sel'];
    case SLOT.PENDING: return ['Waiting for approval', 'Taken', 'bad'];
    case SLOT.BOOKED:
    case SLOT.APPROVED: return ['Booked', 'Taken', 'bad'];
    case SLOT.CLASS: return ['CLS class', 'Class', 'cls'];
    case SLOT.HOLIDAY: return ['Holiday', 'Closed', 'cls'];
    case SLOT.BLOCKED: return [s.reason || 'Blocked', 'Blocked', 'cls'];
    case SLOT.OUTSIDE_WINDOW: return ['Not open yet', 'Later', 'cls'];
    default: return ['Closed', 'Closed', 'cls'];
  }
}

/**
 * Phone booking view: a row of day chips and the hours of that day as a list
 * with Free / Taken / Class pills. Tap free hours to select them (next to each
 * other, up to the daily limit); the bar at the bottom opens the form.
 */
const TAKEN = [SLOT.PENDING, SLOT.BOOKED, SLOT.APPROVED];

export default function SlotList({ dates, day, onDay, slotsByDate, selection, onSelection, maxSelect, onContinue, disabled, holidays, today, isWatching, onWatch, nightEnd = 9 }) {
  const [showNight, setShowNight] = useState(false);
  const allSlots = (slotsByDate[day] || []).filter((s) => s.state !== SLOT.PAST);
  // Early-morning hours (12 AM – 9 AM) are folded away unless asked for.
  const nightSlots = allSlots.filter((s) => s.hour < nightEnd);
  const nightOpen = showNight || nightSlots.some((s) => selection?.date === day && s.hour >= selection.start && s.hour < selection.end);
  const daySlots = nightOpen ? allSlots : allSlots.filter((s) => s.hour >= nightEnd);
  const chipsRef = useRef(null);
  useEffect(() => {
    chipsRef.current?.querySelector('.sl-day.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [day]);

  const sel = selection && selection.date === day ? selection : null;
  const isSel = (h) => sel && h >= sel.start && h < sel.end;
  const bookable = (h) => BOOKABLE_STATES.includes((slotsByDate[day] || []).find((s) => s.hour === h)?.state);

  // Hours you can't book (class, taken, closed…) are merged into one row per run.
  const rows = [];
  for (const s of daySlots) {
    const last = rows[rows.length - 1];
    const merge = last && !BOOKABLE_STATES.includes(s.state) && !isSel(s.hour) && last.end === s.hour
      && !BOOKABLE_STATES.includes(last.s.state) && !isSel(last.s.hour)
      && slotLook(last.s).join() === slotLook(s).join() && (last.s.bookingId || '') === (s.bookingId || '');
    if (merge) last.end = s.hour + 1;
    else rows.push({ s, end: s.hour + 1 });
  }

  const tap = (s) => {
    if (disabled || !BOOKABLE_STATES.includes(s.state)) return;
    const h = s.hour;
    if (!sel) return onSelection({ date: day, start: h, end: h + 1 });
    if (isSel(h)) {
      // Tap an end hour to drop it; tap the middle to start again from there.
      if (sel.end - sel.start === 1) return onSelection(null);
      if (h === sel.start) return onSelection({ ...sel, start: h + 1 });
      if (h === sel.end - 1) return onSelection({ ...sel, end: h });
      return onSelection({ date: day, start: h, end: h + 1 });
    }
    const start = Math.min(sel.start, h);
    const end = Math.max(sel.end, h + 1);
    let ok = end - start <= maxSelect;
    for (let x = start; ok && x < end; x++) ok = bookable(x);
    onSelection(ok ? { date: day, start, end } : { date: day, start: h, end: h + 1 });
  };

  return (
    <div className="sl">
      <div className="sl-days" ref={chipsRef}>
        {dates.map((d) => {
          const free = (slotsByDate[d] || []).filter((s) => BOOKABLE_STATES.includes(s.state)).length;
          return (
            <button key={d} className={`sl-day ${d === day ? 'on' : ''} ${holidays[d] ? 'hol' : ''}`} onClick={() => onDay(d)}>
              <span>{d === today ? 'Today' : DAY_NAMES[dayOfWeek(d)]}</span>
              <b>{Number(d.slice(8))}</b>
              <i className={free ? 'has' : ''}>{free ? `${free} free` : 'full'}</i>
            </button>
          );
        })}
      </div>

      <div className="sl-head">
        <b>{DAY_NAMES[dayOfWeek(day)]} {Number(day.slice(8))} {MONTHS[Number(day.slice(5, 7)) - 1]}</b>
        {holidays[day] ? <span className="small muted"> · Holiday — {holidays[day].name || holidays[day]}</span> : null}
      </div>

      {allSlots.length === 0 ? <p className="small muted" style={{ padding: '12px 4px' }}>No more hours today — pick another day.</p> : (
        <div className="sl-list">
          {nightSlots.length > 0 && (
            <button type="button" className="sl-night" onClick={() => setShowNight(!nightOpen)}>
              <span className="grow">{nightOpen ? 'Hide' : 'Show'} night hours ({shortHour(nightSlots[0].hour)} – {shortHour(nightEnd)})</span>
              <span className="pill wait">{nightSlots.filter((s) => BOOKABLE_STATES.includes(s.state)).length} special</span>
            </button>
          )}
          {rows.map(({ s, end }) => {
            const [text, pill, tone] = slotLook(s);
            const on = isSel(s.hour);
            const can = !disabled && BOOKABLE_STATES.includes(s.state);
            if (onWatch && TAKEN.includes(s.state)) {
              // Someone else's booking: ask to be emailed if it is cancelled or rejected.
              const hours = [];
              for (let h = s.hour; h < end; h++) hours.push(h);
              const watching = hours.every((h) => isWatching(day, h));
              return (
                <div key={s.hour} className="sl-slot taken">
                  <span className="t">{shortHour(s.hour)}</span>
                  <span className="grow muted">{end > s.hour + 1 ? `${text} · till ${shortHour(end)}` : text}</span>
                  <button type="button" className={`sl-bell ${watching ? 'on' : ''}`} onClick={() => onWatch(day, hours, !watching)}
                    title={watching ? 'You will get an email if this frees up. Tap to stop.' : 'Email me if this frees up'}>
                    <Icon name="bell" />{watching ? 'Alert on' : 'Notify me'}
                  </button>
                </div>
              );
            }
            return (
              <button key={s.hour} type="button" className={`sl-slot ${on ? 'mine' : ''} ${can ? 'can' : ''}`} onClick={() => tap(s)} disabled={!can && !on}>
                <span className="t">{shortHour(s.hour)}</span>
                <span className={`grow ${on ? '' : 'muted'}`}>{on ? 'Your selection' : end > s.hour + 1 ? `${text} · till ${shortHour(end)}` : text}</span>
                <span className={`pill ${on ? 'sel' : tone}`}>{on ? 'Selected' : pill}</span>
              </button>
            );
          })}
        </div>
      )}

      {sel && (
        <div className="sl-sheet">
          <div className="grow">
            <b>{DAY_NAMES[dayOfWeek(sel.date)]} {Number(sel.date.slice(8))} {MONTHS[Number(sel.date.slice(5, 7)) - 1]} · {shortRange(sel.start, sel.end)}</b>
            <div className="tiny muted">{sel.end - sel.start} h selected · up to {maxSelect} h · tap next hour to extend</div>
          </div>
          <button className="btn btn-primary" onClick={onContinue}>Continue</button>
        </div>
      )}
    </div>
  );
}
