import { useState } from 'react';
import { Link } from 'react-router-dom';
import { orderByChild, limitToLast } from 'firebase/database';

import { useLiveList, dbQuery } from '../../lib/hooks.js';
import { PageHead, Empty } from '../../components/ui.jsx';
import { actionLabel } from './AdminDashboard.jsx';
import { formatDateTime } from '@shared/calendar.js';

const ROLE = { main: 'Main Admin', staff: 'Staff Admin', fccc: 'FC-CC', student: 'Student', system: 'System', faculty: 'Faculty' };

export default function AuditLog() {
  const [limit, setLimit] = useState(200);
  const { items, loading } = useLiveList(dbQuery('auditLogs', orderByChild('at'), limitToLast(limit)), [limit]);
  const [text, setText] = useState('');
  const t = text.trim().toLowerCase();
  const rows = [...items]
    .reverse()
    .filter((a) => !t || [a.action, a.name, a.bookingId, a.niftId, JSON.stringify(a.details || '')].some((v) => String(v || '').toLowerCase().includes(t)));

  return (
    <>
      <PageHead eyebrow="Records" title="Audit log" sub="Every important action — registration, bookings, approvals, overrides, classification changes, semester updates.">
        <input className="input" style={{ width: 260 }} placeholder="Filter…" value={text} onChange={(e) => setText(e.target.value)} />
      </PageHead>
      <section className="card">
        {loading ? <div className="card-body muted">Loading…</div> : rows.length === 0 ? <Empty title="No entries" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Action</th><th>By</th><th>Related</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="mono small nowrap">{formatDateTime(a.at)}</td>
                    <td style={{ fontWeight: 600 }}>{actionLabel(a.action)}</td>
                    <td className="small">{a.name}<div className="muted">{ROLE[a.role] || a.role}</div></td>
                    <td className="small nowrap">
                      {a.bookingId && <Link className="mono" to={`/bookings/${a.bookingId}`}>{a.bookingId}</Link>}
                      {a.niftId && <div className="mono muted">{a.niftId}</div>}
                    </td>
                    <td className="small" style={{ maxWidth: 380 }}><Details d={a.details} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {items.length >= limit && (
        <div style={{ marginTop: 12 }}><button className="btn" onClick={() => setLimit(limit + 300)}>Load older entries</button></div>
      )}
    </>
  );
}

function Details({ d }) {
  if (!d) return <span className="muted">—</span>;
  if (d.changes) {
    return Object.entries(d.changes).map(([k, v]) => (
      <div key={k}>{k}: {String(v.from)} → <b>{String(v.to)}</b></div>
    ));
  }
  return (
    <span className="muted">
      {Object.entries(d)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' · ')}
    </span>
  );
}
