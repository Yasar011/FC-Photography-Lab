import { useState } from 'react';
import { Link } from 'react-router-dom';

import { call } from '../../firebase.js';
import { PageHead, Empty, ConfirmModal, useToast, StatusBadge } from '../../components/ui.jsx';
import { useStatusList } from './AdminDashboard.jsx';
import { STATUS, STATUS_META } from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime } from '@shared/calendar.js';

export default function FacultyConcerns() {
  const { items, loading } = useStatusList(STATUS.FACULTY_CONCERN);
  const [dialog, setDialog] = useState(null);
  const toast = useToast();

  const open = (b, decision) =>
    setDialog({
      title: decision === 'approve' ? `Approve ${b.id}` : `Reject ${b.id}`,
      message: decision === 'approve'
        ? `The booking returns to “${STATUS_META[b.facultyConcern?.previousStatus]?.label || 'Approved'}” — any pending approvals still apply.`
        : 'The booking will be rejected and the slot released.',
      confirmLabel: decision === 'approve' ? 'APPROVED' : 'REJECTED',
      tone: decision === 'approve' ? 'green' : 'danger',
      remarks: 'required',
      onConfirm: async (remarks) => {
        await call('resolveFacultyConcern', { bookingId: b.id, decision, remarks });
        toast('Decision recorded', 'ok');
      },
    });

  return (
    <>
      <PageHead eyebrow="Review" title="Faculty concerns" sub="Faculty reported “I DID NOT APPROVE THIS”. Bookings are not cancelled automatically — decide below.">
        <span className="live-dot">Live</span>
      </PageHead>
      {loading ? <p className="muted">Loading…</p> : items.length === 0 ? <div className="card"><Empty title="No open faculty concerns" /></div> : (
        <div className="stack">
          {items.map((b) => (
            <section key={b.id} className="card">
              <div className="card-head">
                <Link to={`/bookings/${b.id}`} className="booking-id">{b.id}</Link>
                <StatusBadge status={b.status} />
              </div>
              <div className="card-body stack">
                <dl className="kv">
                  <dt>Student</dt><dd>{b.studentName} ({b.niftId}) · {b.department} {b.semester}</dd>
                  <dt>Booking</dt><dd>{formatDate(b.date, { weekday: true })} · {formatRange(b.startHour, b.endHour)} — {b.purpose}</dd>
                  <dt>Faculty</dt><dd>{b.facultyConcern?.facultyName} — {b.facultyConcern?.facultyEmail}</dd>
                  <dt>Reported</dt><dd>{formatDateTime(b.facultyConcern?.at)}</dd>
                  <dt>Faculty remarks</dt><dd>{b.facultyConcern?.remarks || '—'}</dd>
                  <dt>Status before concern</dt><dd>{STATUS_META[b.facultyConcern?.previousStatus]?.label}</dd>
                </dl>
                <div className="row">
                  <button className="btn btn-green" onClick={() => open(b, 'approve')}>APPROVED</button>
                  <button className="btn btn-danger" onClick={() => open(b, 'reject')}>REJECTED</button>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
      {dialog && <ConfirmModal {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
