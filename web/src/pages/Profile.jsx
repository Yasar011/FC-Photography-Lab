import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { call } from '../firebase.js';
import { useAction } from '../lib/hooks.js';
import { PageHead, Field, Alert, TypeBadge, AccountBadge, useToast } from '../components/ui.jsx';
import { DEPARTMENT_NAMES } from '@shared/constants.js';
import { formatDateTime } from '@shared/calendar.js';

export default function Profile() {
  const { profile } = useAuth();
  const [phone, setPhone] = useState(profile.phone || '');
  const { busy, error, run } = useAction();
  const toast = useToast();

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await call('updateMyProfile', { phone });
      toast('Phone number updated', 'ok');
    });
  };

  return (
    <>
      <PageHead eyebrow="Account" title="Profile" />
      <div className="split">
        <section className="card">
          <div className="card-head"><h2>{profile.name}</h2><AccountBadge status={profile.status} /></div>
          <div className="card-body">
            <dl className="kv">
              <dt>Name</dt><dd>{profile.name}</dd>
              <dt>NIFT ID</dt><dd className="mono">{profile.niftId}</dd>
              <dt>Email</dt><dd>{profile.email}</dd>
              <dt>Phone</dt><dd>{profile.phone}</dd>
              <dt>Department</dt><dd>{profile.department} — {DEPARTMENT_NAMES[profile.department]}</dd>
              <dt>Semester</dt><dd>{profile.semester}</dd>
              <dt>Student Type</dt><dd><TypeBadge type={profile.studentType} /></dd>
              <dt>Account Status</dt><dd><AccountBadge status={profile.status} /></dd>
              <dt>Booking access</dt><dd>{profile.bookingAccess === false ? 'Disabled' : 'Enabled'}</dd>
              <dt>Registered</dt><dd>{formatDateTime(profile.createdAt)}</dd>
            </dl>
            <p className="tiny muted" style={{ marginTop: 14 }}>
              Name, NIFT ID, department, semester and student type are managed by the FC Staff. Your NIFT email comes from
              Google sign-in. Semesters advance automatically each academic term.
            </p>
          </div>
        </section>
        <form className="card" onSubmit={save}>
          <div className="card-head"><h2>Update contact</h2></div>
          <div className="card-body stack">
            <Field label="Phone Number" required>
              <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </Field>
            <Alert kind="error">{error}</Alert>
            <button className="btn btn-primary" disabled={busy || phone === profile.phone}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
