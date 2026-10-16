import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { call } from '../firebase.js';
import { Alert, Field, Loading, Camera, StatusBadge } from '../components/ui.jsx';
import { formatDateTime } from '@shared/calendar.js';

export default function FacultyResponse() {
  const { bookingId } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') || '';
  const { user, signOut } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    call('getFacultyNotice', { bookingId, token }).then(setData).catch((e) => setError(e.message));
  }, [bookingId, token]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await call('facultyRespond', { bookingId, token, remarks });
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const b = data?.booking;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" style={{ width: 'min(620px, 100%)' }}>
        <div className="card-head">
          <div className="row">
            <span className="brand-mark" style={{ border: '1px solid var(--line)' }}><Camera /></span>
            <div>
              <h2>Faculty notification</h2>
              <div className="small muted">FC Photography Lab · NIFT Jodhpur</div>
            </div>
          </div>
        </div>
        <div className="card-body stack">
          <div className="small muted">Signed in as {user?.email} · <button className="btn btn-ghost btn-sm" onClick={signOut}>Switch account</button></div>
          {!data && !error && <Loading label="Verifying link…" />}
          <Alert kind="error">{error}</Alert>
          {b && (
            <>
              <p>
                This is an informational notification regarding a Photography Lab booking. <b>Faculty approval is not
                required by default.</b>
              </p>
              <dl className="kv">
                <dt>Booking ID</dt><dd className="booking-id">{b.id}</dd>
                <dt>Status</dt><dd><StatusBadge status={b.status} /></dd>
                <dt>Student</dt><dd>{b.studentName}</dd>
                <dt>NIFT ID</dt><dd className="mono">{b.niftId}</dd>
                <dt>Department</dt><dd>{b.department} · Semester {b.semester}</dd>
                <dt>Date</dt><dd>{b.date}</dd>
                <dt>Time</dt><dd>{b.time}</dd>
                <dt>Purpose</dt><dd>{b.purpose}</dd>
                <dt>Equipment</dt><dd>{b.equipment}</dd>
              </dl>
              {data.response || done ? (
                <Alert kind="ok">
                  Your response has been recorded{data.response ? ` on ${formatDateTime(data.response.at)}` : ''}. The FC
                  Staff/FC-CC will review this booking. Thank you.
                </Alert>
              ) : (
                <div className="stack">
                  <p className="small muted">
                    If you did not approve or are not aware of this booking, tell us below. The booking is not cancelled
                    automatically — the FC Staff/FC-CC will review it.
                  </p>
                  <Field label="Remarks (optional)">
                    <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} />
                  </Field>
                  <button className="btn btn-accent btn-lg" onClick={submit} disabled={busy}>
                    {busy ? 'Recording…' : 'I DID NOT APPROVE THIS'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
