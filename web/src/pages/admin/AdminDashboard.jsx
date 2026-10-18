import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { orderByChild, startAt, endAt, equalTo, limitToLast } from 'firebase/database';

import { useAuth } from '../../lib/auth.jsx';
import { useLive, useLiveList, dbQuery, useNow } from '../../lib/hooks.js';
import { PageHead, StatusBadge, Empty } from '../../components/ui.jsx';
import { daySlots, useSlotRange } from '../../components/Calendar.jsx';
import IdmRequests from '../../components/IdmRequests.jsx';
import { STATUS, ACTIVE_STATUSES, ROLE_LABELS } from '@shared/constants.js';
import { todayIST, addDays, formatDate, formatRange, formatDateTime, istParts, BOOKABLE_STATES } from '@shared/calendar.js';

export function useStatusList(status) {
  const q = useMemo(() => dbQuery('bookings', orderByChild('status'), equalTo(status)), [status]);
  const { value, loading } = useLive(q, [q]);
  return { items: Object.values(value || {}).sort((a, b) => a.startAt - b.startAt), loading };
}

export const actionLabel = (a) =>
  a
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(/\b(fc|cc|id)\b/gi, (m) => m.toUpperCase());

export default function AdminDashboard() {
  const { role, rules, settings, isStaff } = useAuth();
  const now = useNow(30000);
  const today = todayIST(now);
  const horizon = addDays(today, 14);
  const q = useMemo(() => dbQuery('bookings', orderByChild('date'), startAt(today), endAt(horizon)), [today, horizon]);
  const { value } = useLive(q, [q]);
  const upcoming = Object.values(value || {})
    .filter((b) => ACTIVE_STATUSES.includes(b.status) && b.endAt > now)
    .sort((a, b) => a.startAt - b.startAt);
  const todays = Object.values(value || {}).filter((b) => b.date === today && b.status !== STATUS.CANCELLED_BY_STUDENT && b.status !== STATUS.CANCELLED_BY_ADMIN && b.status !== STATUS.REJECTED).sort((a, b) => a.startAt - b.startAt);

  const fcPending = useStatusList(STATUS.PENDING_FC_APPROVAL);
  const special = useStatusList(STATUS.PENDING_SPECIAL_APPROVAL);
  const fcccQ = useStatusList(STATUS.PENDING_FCCC_APPROVAL);
  const concerns = useStatusList(STATUS.FACULTY_CONCERN);

  const { slots } = useSlotRange(today, today);
  const todaySlots = daySlots({ date: today, rules, settings, slots, nowMs: now, staffView: true, ignoreWindow: true });
  const freeToday = todaySlots.filter((s) => BOOKABLE_STATES.includes(s.state)).length;

  const hour = istParts(now).hour;
  const current = todays.find((b) => b.startHour <= hour && b.endHour > hour && ACTIVE_STATUSES.includes(b.status));
  const next = upcoming.find((b) => b.startAt > now);

  const { items: activity } = useLiveList(dbQuery('auditLogs', orderByChild('at'), limitToLast(15)), []);

  const stats = [
    ["Today's bookings", todays.length, '/admin/calendar'],
    ['Upcoming (14 days)', upcoming.length, '/admin/bookings'],
    ['Awaiting FC-CC approval', fcccQ.items.length, '/admin/approvals'],
    ['Pending FC approval', fcPending.items.length, '/admin/bookings?status=PENDING_FC_APPROVAL'],
    ['Special approvals', special.items.length, '/admin/special'],
    ['Faculty concerns', concerns.items.length, '/admin/concerns'],
    ['Free slots today', freeToday, '/admin/calendar'],
  ];

  return (
    <>
      <PageHead eyebrow={ROLE_LABELS[role]} title="Admin dashboard" sub={formatDate(today, { weekday: true })}>
        <span className="live-dot">Live</span>
        <Link className="btn btn-primary" to="/admin/calendar">Open calendar</Link>
      </PageHead>

      <div className="stack-lg">
        {isStaff && <IdmRequests />}
        <div className="grid grid-4">
          {stats.map(([k, v, to]) => (
            <Link key={k} to={to} className="card stat" style={{ textDecoration: 'none' }}>
              <div className="k">{k}</div>
              <div className="v">{v}</div>
            </Link>
          ))}
        </div>

        <section className="card card-pad row-between" style={{ background: current ? 'var(--ink)' : 'var(--surface)', color: current ? '#fff' : undefined }}>
          <div>
            <div className="small" style={{ opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current lab status</div>
            {current ? (
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                In use — {current.studentName} ({current.niftId}) · {formatRange(current.startHour, current.endHour)}
              </div>
            ) : (
              <div style={{ fontSize: 18, fontWeight: 600 }}>Free right now</div>
            )}
            {next && (
              <div className="small" style={{ opacity: 0.8 }}>
                Next: {formatDate(next.date, { weekday: true })} {formatRange(next.startHour, next.endHour)} — {next.studentName}
              </div>
            )}
          </div>
          {current && <Link className="btn" to={`/bookings/${current.id}`}>View</Link>}
        </section>

        <div className="split">
          <div className="stack-lg">
            <BookingList title="Today's bookings" items={todays} empty="No bookings today" />
            <BookingList title="Special approvals in progress" items={special.items} empty="None waiting" link="/admin/special" />
            <BookingList title="Faculty concerns" items={concerns.items} empty="No open concerns" link="/admin/concerns" />
            <BookingList title="Upcoming" items={upcoming.slice(0, 10)} empty="Nothing upcoming" link="/admin/bookings" />
          </div>
          <section className="card">
            <div className="card-head"><h2>Recent activity</h2><Link className="small" to="/admin/audit">All →</Link></div>
            <div className="card-body">
              {activity.length === 0 ? <p className="muted small">No activity yet.</p> : (
                <ol className="timeline">
                  {[...activity].reverse().map((a) => (
                    <li key={a.id}>
                      <div className="t-when">{formatDateTime(a.at)}</div>
                      <div className="t-what" style={{ fontSize: 13 }}>{actionLabel(a.action)}</div>
                      <div className="t-by">
                        {a.name}
                        {a.bookingId && <> · <Link to={`/bookings/${a.bookingId}`} className="mono">{a.bookingId}</Link></>}
                        {a.niftId && !a.bookingId ? ` · ${a.niftId}` : ''}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export function BookingList({ title, items, empty, link }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title} <span className="muted mono small">({items.length})</span></h2>
        {link && <Link className="small" to={link}>Open →</Link>}
      </div>
      {items.length === 0 ? <Empty title={empty} /> : items.map((b) => (
        <Link key={b.id} to={`/bookings/${b.id}`} className="list-item">
          <div style={{ minWidth: 0 }}>
            <div className="small"><span className="booking-id">{b.id}</span> · {formatDate(b.date, { weekday: true })} · <span className="mono">{formatRange(b.startHour, b.endHour)}</span></div>
            <div style={{ fontWeight: 600 }}>{b.studentName} <span className="muted small">({b.niftId} · {b.department} {b.semester})</span></div>
            <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.purpose}</div>
          </div>
          <StatusBadge status={b.status} />
        </Link>
      ))}
    </section>
  );
}
