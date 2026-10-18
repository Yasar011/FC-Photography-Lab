import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { orderByChild, startAt, endAt } from 'firebase/database';

import { useAuth } from '../../lib/auth.jsx';
import { useLive, dbQuery } from '../../lib/hooks.js';
import { PageHead, Empty } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { STATUS, PENDING_STATUSES } from '@shared/constants.js';
import { DEFAULT_EQUIPMENT, sortedEntries } from '@shared/defaults.js';
import { todayIST, addDays, formatDate, formatRange, formatDateTime } from '@shared/calendar.js';

const USED = [STATUS.APPROVED, STATUS.COMPLETED];

function periodRange(key, today) {
  if (key === 'next7') return { from: today, to: addDays(today, 6), label: 'Next 7 days' };
  if (key === 'month') return { from: `${today.slice(0, 8)}01`, to: `${today.slice(0, 8)}31`, label: 'This month' };
  if (key === '30') return { from: addDays(today, -29), to: today, label: 'Last 30 days' };
  if (key === '180') return { from: addDays(today, -182), to: today, label: 'Last 6 months' };
  return { from: '2000-01-01', to: '2999-12-31', label: 'All time' };
}

/**
 * Equipment usage tracker: how often each item is used (bookings, hours,
 * students, departments), what is coming up, what is out right now and which
 * returns had a problem.
 */
export default function EquipmentUsage() {
  const { equipment: config } = useAuth();
  const today = todayIST();
  const [period, setPeriod] = useState('30');
  const range = periodRange(period, today);

  const q = useMemo(() => dbQuery('bookings', orderByChild('date'), startAt(range.from), endAt(range.to)), [range.from, range.to]);
  const { value, loading } = useLive(q, [q]);
  const recentQ = useMemo(() => dbQuery('bookings', orderByChild('date'), startAt(addDays(today, -30)), endAt(today)), [today]);
  const { value: recent } = useLive(recentQ, [recentQ]);

  const items = sortedEntries(Object.keys(config || {}).length ? config : DEFAULT_EQUIPMENT);
  const bookings = Object.values(value || {});

  const stats = items.map((item) => {
    const uses = bookings.filter((b) => b.equipment?.[item.id] && USED.includes(b.status));
    const pending = bookings.filter((b) => b.equipment?.[item.id] && PENDING_STATUSES.includes(b.status));
    const departments = {};
    for (const b of uses) departments[b.department] = (departments[b.department] || 0) + 1;
    return {
      ...item,
      uses: uses.length,
      hours: uses.reduce((h, b) => h + (Number(b.duration) || 0), 0),
      students: new Set(uses.map((b) => b.studentUid)).size,
      pending: pending.length,
      departments: Object.entries(departments).sort((a, b) => b[1] - a[1]),
    };
  });
  const maxHours = Math.max(1, ...stats.map((s) => s.hours));

  const out = Object.values(recent || {}).filter((b) => b.equipmentLog?.issued && !b.equipmentLog?.returned)
    .sort((a, b) => a.startAt - b.startAt);
  const problems = bookings.filter((b) => b.equipmentLog?.returned?.condition === 'issue')
    .sort((a, b) => b.equipmentLog.returned.at - a.equipmentLog.returned.at);

  const downloadCsv = () => {
    const rows = [['Date', 'Time', 'Booking', 'Student', 'NIFT ID', 'Department', 'Equipment', 'Status', 'Issued', 'Returned', 'Condition', 'Note']];
    for (const b of [...bookings].sort((a, c) => a.startAt - c.startAt)) {
      const log = b.equipmentLog || {};
      rows.push([
        b.date, formatRange(b.startHour, b.endHour), b.id, b.studentName, b.niftId, b.department,
        (b.equipmentList || []).join('; '), b.status,
        log.issued ? formatDateTime(log.issued.at) : '', log.returned ? formatDateTime(log.returned.at) : '',
        log.returned?.condition || '', log.returned?.note || log.issued?.note || '',
      ]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `equipment-usage-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHead eyebrow="Tracker" title="Equipment usage" sub="Approved and completed bookings. Pending = waiting for approval.">
        <button className="btn btn-sm" onClick={downloadCsv} disabled={!bookings.length}><Icon name="list" /> Download CSV</button>
      </PageHead>

      <div className="tabs" role="tablist">
        {['next7', '30', 'month', '180', 'all'].map((k) => (
          <button key={k} role="tab" aria-selected={period === k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>
            {periodRange(k, today).label}
          </button>
        ))}
      </div>

      {loading ? <p className="muted">Loading…</p> : (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Equipment</th><th>Bookings</th><th>Hours used</th><th style={{ width: '30%' }} /><th>Students</th><th>Pending</th><th>Most used by</th></tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.id} style={s.enabled ? undefined : { opacity: 0.55 }}>
                    <td style={{ fontWeight: 600 }}>{s.name}{s.enabled ? '' : ' (off)'}</td>
                    <td className="mono">{s.uses}</td>
                    <td className="mono">{s.hours} h</td>
                    <td><div className="usage-bar"><span style={{ width: `${(s.hours / maxHours) * 100}%` }} /></div></td>
                    <td className="mono">{s.students}</td>
                    <td className="mono">{s.pending || '—'}</td>
                    <td className="small">{s.departments.slice(0, 3).map(([d, n]) => `${d} ${n}`).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h2>Out right now</h2><span className="small muted">Issued, not returned</span></div>
          {out.length === 0 ? <Empty title="Everything is back" /> : (
            <ul className="usage-list">
              {out.map((b) => (
                <li key={b.id} className={b.endAt < Date.now() ? 'late' : ''}>
                  <Link to={`/bookings/${b.id}`}><b>{b.studentName}</b> · {formatDate(b.date)} {formatRange(b.startHour, b.endHour)}</Link>
                  <div className="small muted">{(b.equipmentLog.issued.items || b.equipmentList || []).join(', ')}{b.endAt < Date.now() ? ' · overdue' : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Problems reported</h2><span className="small muted">{range.label}</span></div>
          {problems.length === 0 ? <Empty title="No damage or missing items" /> : (
            <ul className="usage-list">
              {problems.map((b) => (
                <li key={b.id} className="late">
                  <Link to={`/bookings/${b.id}`}><b>{b.studentName}</b> ({b.niftId}) · {formatDate(b.date)}</Link>
                  <div className="small">{b.equipmentLog.returned.note}</div>
                  <div className="tiny muted">Reported by {b.equipmentLog.returned.byName} · {formatDateTime(b.equipmentLog.returned.at)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
