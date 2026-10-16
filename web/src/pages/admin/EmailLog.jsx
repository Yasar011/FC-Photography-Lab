import { Link } from 'react-router-dom';
import { orderByChild, limitToLast } from 'firebase/database';

import { useLiveList, dbQuery } from '../../lib/hooks.js';
import { PageHead, Empty } from '../../components/ui.jsx';
import { formatDateTime } from '@shared/calendar.js';

const TONE = { sent: 'green', queued: 'yellow', failed: 'red', 'not-configured': 'orange', skipped: 'grey' };

export default function EmailLog() {
  const { items, loading } = useLiveList(dbQuery('emailLogs', orderByChild('createdAt'), limitToLast(300)), []);
  const rows = [...items].reverse();
  const notConfigured = rows.some((r) => r.status === 'not-configured');
  return (
    <>
      <PageHead eyebrow="Records" title="Email log" sub="Every notification sent by the backend, with delivery status." />
      {notConfigured && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          Some emails were not sent because SMTP is not configured. See README → “Email notifications”.
        </div>
      )}
      <section className="card">
        {loading ? <div className="card-body muted">Loading…</div> : rows.length === 0 ? <Empty title="No emails yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Type</th><th>Recipient</th><th>Booking</th><th>Trigger</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="mono small nowrap">{formatDateTime(e.createdAt)}</td>
                    <td className="small">{e.type?.replace(/_/g, ' ')}<div className="muted">{e.subject}</div></td>
                    <td className="small">{e.recipient}</td>
                    <td className="small">{e.bookingId && <Link className="mono" to={`/bookings/${e.bookingId}`}>{e.bookingId}</Link>}</td>
                    <td className="small mono">{e.trigger}</td>
                    <td>
                      <span className={`badge tone-${TONE[e.status] || 'grey'}`}>{e.status}</span>
                      {e.error && <div className="tiny muted">{e.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
