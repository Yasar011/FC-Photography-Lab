import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dayOfWeek, DAY_NAMES, formatHour, formatRange, istParts, SLOT, todayIST } from '@shared/calendar.js';
import { STATUS_META } from '@shared/constants.js';

const HOUR = 52; // keep in sync with --hour in styles.css

/** Group an ordered list of classified hour-slots into calendar blocks. */
export function buildBlocks(slots) {
  const blocks = [];
  let cur = null;
  const keyOf = (s) => {
    if (s.bookingId) return `b:${s.bookingId}`;
    if (s.state === SLOT.CLASS) return 'class';
    if (s.state === SLOT.BLOCKED) return `blocked:${s.reason || ''}`;
    if (s.state === SLOT.OVERRIDE_OPEN) return 'override';
    if (s.state === SLOT.SPECIAL) return 'special';
    return null;
  };
  for (const s of slots) {
    const k = keyOf(s);
    if (cur && k && cur.key === k && cur.end === s.hour) {
      cur.end += 1;
      continue;
    }
    cur = k ? { key: k, start: s.hour, end: s.hour + 1, slot: s } : null;
    if (cur) blocks.push(cur);
  }
  return blocks;
}

const EVENT_CLASS = { MINE: 'mine', APPROVED: 'approved', BOOKED: 'booked', PENDING: 'pending' };

/**
 * Google-Calendar-style time grid.
 *  - columns = dates, rows = hours (rules.gridStartHour … gridEndHour)
 *  - drag (or tap) on selectable cells to choose a time range
 *  - existing bookings render as event blocks; click opens a popover
 */
export default function TimeGrid({
  dates,
  rules,
  slotsByDate,
  nowMs,
  selection,
  onSelect,
  canSelect,
  maxSelect = 3,
  describe,
  onEventClick,
  holidays = {},
  onHolidayClick,
  onDayClick,
  freeCount,
  disabledDates = [],
  scrollToHour = 16,
}) {
  const scrollRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const today = todayIST(nowMs);
  const hours = [];
  for (let h = rules.gridStartHour; h < rules.gridEndHour; h++) hours.push(h);
  const cols = `56px repeat(${dates.length}, minmax(${dates.length > 3 ? 92 : 0}px, 1fr))`;
  const anyHoliday = dates.some((d) => holidays[d]);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (scrollToHour - rules.gridStartHour) * HOUR - 24);
  }, [scrollToHour, rules.gridStartHour]);

  const hourAt = (e, col) => {
    const rect = col.getBoundingClientRect();
    return rules.gridStartHour + Math.floor((e.clientY - rect.top) / HOUR);
  };

  const rangeFrom = (date, anchor, hour) => {
    const slots = slotsByDate[date] || [];
    const ok = (h) => {
      const s = slots.find((x) => x.hour === h);
      return s && canSelect?.(s);
    };
    let start = anchor;
    let end = anchor + 1;
    if (hour >= anchor) {
      for (let h = anchor + 1; h <= hour && end - start < maxSelect && ok(h); h++) end = h + 1;
    } else {
      for (let h = anchor - 1; h >= hour && end - start < maxSelect && ok(h); h--) start = h;
    }
    return { date, start, end };
  };

  const down = (e, date, slot) => {
    if (!onSelect || !canSelect?.(slot) || e.button > 0) return;
    e.preventDefault();
    try {
      e.currentTarget.parentElement.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety (drag outside the column); selection works without it */
    }
    setDrag({ date, anchor: slot.hour, start: slot.hour, end: slot.hour + 1 });
  };
  const move = (e, date) => {
    if (!drag || drag.date !== date) return;
    const r = rangeFrom(date, drag.anchor, hourAt(e, e.currentTarget));
    if (r.start !== drag.start || r.end !== drag.end) setDrag({ ...drag, ...r });
  };
  const up = () => {
    if (!drag) return;
    onSelect({ date: drag.date, start: drag.start, end: drag.end });
    setDrag(null);
  };
  useEffect(() => {
    if (!drag) return undefined;
    const cancel = () => setDrag(null);
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [drag]);

  const sel = drag || selection;
  const nowP = istParts(nowMs);
  const nowTop = (nowP.hour + nowP.minute / 60 - rules.gridStartHour) * HOUR;

  return (
    <div className="tg" role="grid" aria-label="Lab calendar">
      <div className="tg-head" style={{ gridTemplateColumns: cols }}>
        <div />
        {dates.map((d) => {
          const off = disabledDates.includes(d);
          const free = freeCount?.[d];
          return (
            <div key={d} className={`tg-dayhead ${d === today ? 'today' : ''} ${off ? 'off' : ''}`}>
              <button type="button" onClick={() => onDayClick?.(d)} aria-label={`Show ${d}`}>
                <span className="dow">{DAY_NAMES[dayOfWeek(d)]}</span>
                <span className="dnum">{Number(d.slice(8))}</span>
                {free !== undefined && !off && <span className={`free ${free ? '' : 'none'}`}>{free ? `${free} free` : 'Full'}</span>}
              </button>
            </div>
          );
        })}
      </div>

      {anyHoliday && (
        <div className="tg-allday" style={{ gridTemplateColumns: cols }}>
          <div className="lbl">Holiday</div>
          {dates.map((d) => {
            const h = holidays[d];
            const Tag = onHolidayClick ? 'button' : 'span';
            return (
              <div key={d} className="cell">
                {h && (
                  <Tag className={`allday-chip ${h.open ? 'open' : ''}`} onClick={onHolidayClick ? () => onHolidayClick(d) : undefined} title={h.name}>
                    {h.name}{h.open ? ' · open' : ''}
                  </Tag>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ gridTemplateColumns: cols }}>
          <div className="tg-times">
            {hours.map((h) => <div key={h}><span>{formatHour(h).replace(':00', '')}</span></div>)}
          </div>
          {dates.map((d) => {
            const slots = slotsByDate[d] || [];
            const blocks = buildBlocks(slots);
            return (
              <div
                key={d}
                className={`tg-col ${d === today ? 'today' : ''}`}
                onPointerMove={(e) => move(e, d)}
                onPointerUp={up}
                onPointerCancel={() => setDrag(null)}
              >
                {slots.map((s) => {
                  const selectable = Boolean(onSelect) && canSelect?.(s);
                  return (
                    <div
                      key={s.hour}
                      className={`tg-cell c-${s.state} ${selectable ? 'selectable' : ''}`}
                      data-label={selectable ? `+ ${formatHour(s.hour)}` : undefined}
                      onPointerDown={(e) => down(e, d, s)}
                      role="gridcell"
                      aria-label={`${d} ${formatRange(s.hour, s.hour + 1)}`}
                    />
                  );
                })}

                {blocks.map((b) => {
                  const top = (b.start - rules.gridStartHour) * HOUR + 1;
                  const height = (b.end - b.start) * HOUR - 3;
                  const style = { top, height };
                  const s = b.slot;
                  if (s.bookingId) {
                    const info = describe?.(s) || {};
                    const cls = EVENT_CLASS[s.state] || 'booked';
                    const pend = s.state === SLOT.MINE && STATUS_META[s.status]?.tone !== 'green' && s.status !== 'COMPLETED';
                    return (
                      <button
                        key={b.key + b.start}
                        type="button"
                        className={`tg-ev ${cls} ${pend ? 'pend' : ''}`}
                        style={style}
                        onClick={(e) => onEventClick?.(s.bookingId, e.currentTarget.getBoundingClientRect())}
                      >
                        <div className="t">{info.title || 'Booked'}</div>
                        <div className="s">{formatRange(b.start, b.end)}{info.sub ? ` · ${info.sub}` : ''}</div>
                      </button>
                    );
                  }
                  if (b.key === 'class') {
                    return (
                      <div key={b.key + b.start} className="tg-ev deco class" style={style}>
                        <div className="t">{s.label || rules.classLabel}</div>
                        <div className="s">{formatRange(b.start, b.end)} · reserved for classes</div>
                      </div>
                    );
                  }
                  if (b.key.startsWith('blocked')) {
                    return (
                      <div key={b.key + b.start} className="tg-ev deco blocked" style={style}>
                        <div className="t">Blocked</div>
                        {s.reason && <div className="s">{s.reason}</div>}
                      </div>
                    );
                  }
                  if (b.key === 'override') {
                    return (
                      <div key={b.key + b.start} className="tg-ev deco override" style={{ ...style, background: 'transparent' }}>
                        <div className="t">Opened by FC Staff</div>
                      </div>
                    );
                  }
                  if (b.key === 'special') {
                    return (
                      <div key={b.key + b.start} className="tg-ev deco speciallbl" style={{ ...style, height: 22 }}>
                        <div className="t">★ Special approval</div>
                      </div>
                    );
                  }
                  return null;
                })}

                {sel && sel.date === d && (
                  <div
                    className={`tg-ev selection ${slots.some((s) => s.hour >= sel.start && s.hour < sel.end && s.requiresSpecial) ? 'warn' : ''}`}
                    style={{ top: (sel.start - rules.gridStartHour) * HOUR + 1, height: (sel.end - sel.start) * HOUR - 3 }}
                  >
                    <div className="t">New booking</div>
                    <div className="s">{formatRange(sel.start, sel.end)}</div>
                  </div>
                )}

                {d === today && nowTop > 0 && nowTop < hours.length * HOUR && <div className="tg-now" style={{ top: nowTop }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
