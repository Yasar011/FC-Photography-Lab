import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../lib/auth.jsx';
import { call } from '../../firebase.js';
import { PageHead, Field, Alert, Empty, ConfirmModal, useToast } from '../../components/ui.jsx';
import { todayIST, formatDate, formatRange, formatDateTime, hourFromKey } from '@shared/calendar.js';

export default function Availability() {
  const { settings } = useAuth();
  const toast = useToast();
  const today = todayIST();
  const [form, setForm] = useState({ date: '', name: '', open: false, requiresSpecial: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const holidays = Object.entries(settings.holidays || {})
    .map(([date, h]) => ({ date, ...h }))
    .filter((h) => showPast || h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const overrides = [];
  for (const [date, hours] of Object.entries(settings.availabilityOverrides || {})) {
    if (date < today) continue;
    for (const [key, o] of Object.entries(hours || {})) overrides.push({ date, hour: hourFromKey(key), ...o });
  }
  overrides.sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await call('setHoliday', form);
      toast('Holiday saved', 'ok');
      setForm({ date: '', name: '', open: false, requiresSpecial: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = (title, message, fn, tone = 'primary') =>
    setDialog({ title, message, tone, confirmLabel: title, remarks: 'optional', onConfirm: async (r) => { await fn(r); toast('Saved', 'ok'); } });

  return (
    <>
      <PageHead eyebrow="Staff Admin" title="Holidays & overrides" sub="All changes are recorded in the audit log.">
        <Link className="btn" to="/admin/calendar">Open week calendar</Link>
      </PageHead>
      <div className="split">
        <div className="stack-lg">
          <section className="card">
            <div className="card-head">
              <h2>Public holidays</h2>
              <label className="check small"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show past</label>
            </div>
            {holidays.length === 0 ? <Empty title="No holidays added" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Holiday</th><th>Booking</th><th /></tr></thead>
                  <tbody>
                    {holidays.map((h) => (
                      <tr key={h.date}>
                        <td className="nowrap">{formatDate(h.date, { weekday: true })}</td>
                        <td>{h.name}<div className="tiny muted">by {h.updatedBy}</div></td>
                        <td>
                          {h.open
                            ? <span className="badge tone-green">Open{h.requiresSpecial ? ' · special' : ''}</span>
                            : <span className="badge tone-red">Closed</span>}
                        </td>
                        <td className="nowrap right">
                          {h.open ? (
                            <button className="btn btn-sm btn-danger" onClick={() => confirm('Close holiday', `Close ${formatDate(h.date)} for booking? Only possible if no active booking exists.`, (r) => call('setHoliday', { date: h.date, name: h.name, open: false, remarks: r }), 'danger')}>Close</button>
                          ) : (
                            <button className="btn btn-sm btn-green" onClick={() => confirm('OPEN FOR BOOKING', `Students will be able to book ${formatDate(h.date)}. Normal booking rules still apply.`, (r) => call('setHoliday', { date: h.date, name: h.name, open: true, remarks: r }), 'green')}>Open for booking</button>
                          )}{' '}
                          <button className="btn btn-sm btn-ghost" onClick={() => confirm('Remove holiday', `Treat ${formatDate(h.date)} as a regular day?`, () => call('removeHoliday', { date: h.date }))}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head"><h2>Upcoming slot overrides</h2></div>
            {overrides.length === 0 ? <Empty title="No overrides">Open or block slots from the week calendar.</Empty> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Slot</th><th>Override</th><th>Original</th><th>By / reason</th><th /></tr></thead>
                  <tbody>
                    {overrides.map((o) => (
                      <tr key={`${o.date}-${o.hour}`}>
                        <td className="nowrap">{formatDate(o.date, { weekday: true })}</td>
                        <td className="mono small nowrap">{formatRange(o.hour, o.hour + 1)}</td>
                        <td>
                          {o.type === 'open'
                            ? <span className="badge tone-violet">{o.kind === 'special' ? 'Special availability' : 'Opened'}{o.requiresSpecial ? ' · approval' : ''}</span>
                            : <span className="badge tone-black">Blocked</span>}
                        </td>
                        <td className="small">{o.originalRestriction}</td>
                        <td className="small">{o.byName} · {formatDateTime(o.at)}<div className="muted">{o.reason}</div></td>
                        <td><button className="btn btn-sm btn-ghost" onClick={() => confirm('Remove override', 'Restore normal calendar rules for this slot? Existing bookings are not affected.', (r) => call('removeSlotOverride', { date: o.date, hours: [o.hour], reason: r }))}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <form className="card" onSubmit={add}>
          <div className="card-head"><h2>Add holiday</h2></div>
          <div className="card-body stack">
            <Field label="Date" required><input className="input" type="date" min={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></Field>
            <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali" required /></Field>
            <label className="check"><input type="checkbox" checked={form.open} onChange={(e) => setForm({ ...form, open: e.target.checked })} /> Open for booking</label>
            {form.open && (
              <label className="check"><input type="checkbox" checked={form.requiresSpecial} onChange={(e) => setForm({ ...form, requiresSpecial: e.target.checked })} /> Bookings still need special approval</label>
            )}
            <p className="tiny muted">Public holidays are unavailable for booking unless opened. Closing a date is refused while it has an active booking.</p>
            <Alert kind="error">{error}</Alert>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save holiday'}</button>
          </div>
        </form>
      </div>
      {dialog && <ConfirmModal {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
