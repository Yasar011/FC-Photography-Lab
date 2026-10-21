import { useState } from 'react';
import { Link } from 'react-router-dom';
import { orderByChild, equalTo } from 'firebase/database';

import { useLive, dbQuery } from '../../lib/hooks.js';
import { call } from '../../firebase.js';
import { PageHead, Empty, TypeBadge, AccountBadge, Modal, Field, Alert, useToast, StatusBadge } from '../../components/ui.jsx';
import { useMyBookings } from '../../lib/bookings.js';
import {
  DEPARTMENTS,
  MAX_SEMESTER,
  STUDENT_TYPES,
  STUDENT_TYPE_LABELS,
  ACCOUNT_STATUS,
  ACCOUNT_STATUS_LABELS,
} from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime } from '@shared/calendar.js';

export default function Students() {
  const { value, loading } = useLive('users', []);
  const [filters, setFilters] = useState({ text: '', department: '', studentType: '', status: '' });
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const students = Object.values(value || {})
    .filter((u) => u.niftId)
    .filter((u) => !filters.department || u.department === filters.department)
    .filter((u) => !filters.studentType || u.studentType === filters.studentType)
    .filter((u) => !filters.status || u.status === filters.status)
    .filter((u) => {
      const t = filters.text.trim().toLowerCase();
      return !t || [u.name, u.niftId, u.email, u.phone].some((v) => String(v || '').toLowerCase().includes(t));
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <PageHead eyebrow="Staff Admin" title="Students" sub={`${students.length} student${students.length === 1 ? '' : 's'}`} />
      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="grid grid-4">
          <label className="field"><span className="label">Search</span><input className="input" value={filters.text} onChange={set('text')} placeholder="Name, NIFT ID, email, phone" /></label>
          <label className="field"><span className="label">Department</span>
            <select className="select" value={filters.department} onChange={set('department')}>
              <option value="">All</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Student type</span>
            <select className="select" value={filters.studentType} onChange={set('studentType')}>
              <option value="">All</option>{Object.values(STUDENT_TYPES).map((t) => <option key={t} value={t}>{STUDENT_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Status</span>
            <select className="select" value={filters.status} onChange={set('status')}>
              <option value="">All</option>{Object.values(ACCOUNT_STATUS).map((s) => <option key={s} value={s}>{ACCOUNT_STATUS_LABELS[s]}</option>)}
            </select>
          </label>
        </div>
      </section>
      <section className="card">
        {loading ? <div className="card-body muted">Loading…</div> : students.length === 0 ? <Empty title="No students found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>NIFT ID</th><th>Dept</th><th>Sem</th><th>Student type</th><th>Phone</th><th>Email</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {students.map((u) => (
                  <tr key={u.uid}>
                    <td style={{ fontWeight: 600 }}>{u.name}</td>
                    <td className="mono small nowrap">{u.niftId}</td>
                    <td>{u.department}</td>
                    <td className="mono">{u.semester}</td>
                    <td><TypeBadge type={u.studentType} /></td>
                    <td className="small nowrap">{u.phone}</td>
                    <td className="small">{u.email}</td>
                    <td><AccountBadge status={u.status} /></td>
                    <td className="nowrap">
                      <button className="btn btn-sm btn-ghost" onClick={() => setViewing(u)}>View</button>
                      <button className="btn btn-sm" onClick={() => setEditing(u)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && <EditStudent student={editing} onClose={() => setEditing(null)} />}
      {viewing && <ViewStudent student={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
    </>
  );
}

function LiftBlock({ niftId }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await call('updateStudent', { niftId, clearBookingBlock: true, remarks: 'Booking block lifted by staff' });
          toast('Student can book again', 'ok');
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      Allow booking now
    </button>
  );
}

const BLOCK_DAYS = [1, 2, 3, 4, 7, 14, 30, 60, 90];

function BlockStudent({ niftId }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(4);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="btn btn-sm btn-danger" onClick={() => setOpen(true)}>Block booking…</button>;
  return (
    <div className="block-box">
      <div className="row" style={{ gap: 8 }}>
        <span className="small">Block this student ID for</span>
        <select className="select" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {BLOCK_DAYS.map((n) => <option key={n} value={n}>{n} day{n > 1 ? 's' : ''}</option>)}
        </select>
      </div>
      <input className="input" placeholder="Reason (the student sees this)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn btn-sm btn-danger"
          disabled={busy || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try {
              await call('updateStudent', { niftId, setBookingBlock: { days, reason: reason.trim() } });
              toast(`Booking blocked for ${days} day${days > 1 ? 's' : ''}`, 'ok');
              setOpen(false);
              setReason('');
            } catch (e) {
              toast(e.message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Block
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <div className="tiny muted">Their existing bookings stay. They can't make new bookings until the block ends (you can lift it any time).</div>
    </div>
  );
}

function ViewStudent({ student: u, onClose, onEdit }) {
  const { items } = useMyBookings(u.uid);
  const q = dbQuery('auditLogs', orderByChild('niftId'), equalTo(u.niftId));
  const { value: logs } = useLive(q, [u.niftId]);
  return (
    <Modal title={u.name} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={onEdit}>Edit</button></>}>
      <dl className="kv">
        <dt>NIFT ID</dt><dd className="mono">{u.niftId}</dd>
        <dt>Email</dt><dd>{u.email}</dd>
        <dt>Phone</dt><dd>{u.phone}</dd>
        <dt>Department</dt><dd>{u.department} · Semester {u.semester}</dd>
        <dt>Student type</dt><dd><TypeBadge type={u.studentType} /></dd>
        <dt>Status</dt><dd><AccountBadge status={u.status} /> {u.bookingAccess === false && <span className="small muted">booking access disabled</span>}</dd>
        <dt>Registered</dt><dd>{formatDateTime(u.createdAt)}</dd>
        {u.bookingBlock?.until > Date.now() ? (
          <>
            <dt>Booking blocked</dt>
            <dd>
              Until {formatDateTime(u.bookingBlock.until)}{' '}
              {u.bookingBlock.byStaff ? `(by ${u.bookingBlock.byStaff}: ${u.bookingBlock.reason})` : `(cancelled ${u.bookingBlock.bookingId})`}{' '}
              <LiftBlock niftId={u.niftId} />
            </dd>
          </>
        ) : (
          <>
            <dt>Booking</dt>
            <dd><BlockStudent niftId={u.niftId} /></dd>
          </>
        )}
        {u.graduatedAt && <><dt>Graduated</dt><dd>{formatDateTime(u.graduatedAt)}</dd></>}
      </dl>
      <h3>Bookings ({items.length})</h3>
      <div className="stack" style={{ gap: 6 }}>
        {items.slice(0, 20).map((b) => (
          <Link key={b.id} to={`/bookings/${b.id}`} className="row-between small" style={{ textDecoration: 'none' }}>
            <span><span className="booking-id">{b.id}</span> · {formatDate(b.date)} · {formatRange(b.startHour, b.endHour)}</span>
            <StatusBadge status={b.status} />
          </Link>
        ))}
        {!items.length && <span className="small muted">No bookings.</span>}
      </div>
      <h3>Record history</h3>
      <div className="small stack" style={{ gap: 4 }}>
        {Object.values(logs || {}).sort((a, b) => b.at - a.at).slice(0, 20).map((l, i) => (
          <div key={i}><span className="mono muted">{formatDateTime(l.at)}</span> — {l.action.replace(/_/g, ' ').toLowerCase()} by {l.name}</div>
        ))}
      </div>
    </Modal>
  );
}

function EditStudent({ student, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: student.name,
    phone: student.phone,
    department: student.department,
    semester: String(student.semester),
    studentType: student.studentType,
    status: student.status,
    remarks: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const maxSem = MAX_SEMESTER[form.department] || 8;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await call('updateStudent', { niftId: student.niftId, ...form, semester: Number(form.semester) });
      toast('Student record updated', 'ok');
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Edit — ${student.niftId}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></>}
    >
      <div className="grid grid-2">
        <Field label="Name"><input className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Department">
          <select className="select" value={form.department} onChange={set('department')}>
            {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Semester">
          <select className="select" value={form.semester} onChange={set('semester')}>
            {Array.from({ length: maxSem }, (_, i) => i + 1).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Student type">
          <select className="select" value={form.studentType} onChange={set('studentType')}>
            {Object.values(STUDENT_TYPES).map((t) => <option key={t} value={t}>{STUDENT_TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
        <Field label="Account status">
          <select className="select" value={form.status} onChange={set('status')}>
            {Object.values(ACCOUNT_STATUS).map((s) => <option key={s} value={s}>{ACCOUNT_STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Remarks (logged)"><textarea className="textarea" value={form.remarks} onChange={set('remarks')} /></Field>
      <p className="tiny muted">Only Active accounts can book. Automatic semester progression continues to run from the academic calendar.</p>
      <Alert kind="error">{error}</Alert>
    </Modal>
  );
}
