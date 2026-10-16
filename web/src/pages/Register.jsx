import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { call } from '../firebase.js';
import { useAction } from '../lib/hooks.js';
import { Alert, Field, Camera } from '../components/ui.jsx';
import { DEPARTMENTS, DEPARTMENT_NAMES, MAX_SEMESTER, isValidNiftId, isPhone, normalizeNiftId } from '@shared/constants.js';

export default function Register() {
  const { user, profile, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const { busy, error, setError, run } = useAction();
  const [form, setForm] = useState({
    name: user?.displayName || '',
    niftId: '',
    phone: '',
    department: '',
    semester: '',
  });
  if (profile?.niftId) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'department' ? { semester: '' } : {}) }));
  const maxSem = MAX_SEMESTER[form.department] || 8;

  const submit = (e) => {
    e.preventDefault();
    if (!isValidNiftId(form.niftId)) return setError('Please enter a valid NIFT ID (letters, numbers, "/" or "-").');
    if (!isPhone(form.phone)) return setError('Please enter a valid phone number.');
    run(async () => {
      await call('registerStudent', { ...form, niftId: normalizeNiftId(form.niftId), semester: Number(form.semester) });
      navigate('/', { replace: true });
    });
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card" style={{ width: 'min(560px, 100%)' }} onSubmit={submit}>
        <div className="card-head">
          <div className="row">
            <span className="brand-mark" style={{ border: '1px solid var(--line)' }}><Camera /></span>
            <div>
              <h2>Complete your profile</h2>
              <div className="small muted">FC Photography Lab · NIFT Jodhpur</div>
            </div>
          </div>
        </div>
        <div className="card-body stack">
          {isAdmin && (
            <Alert kind="info">
              <span>You have an admin role. A student profile is optional for admins — <Link to="/admin">go to the admin dashboard</Link>.</span>
            </Alert>
          )}
          <Field label="Full Name" required htmlFor="name">
            <input id="name" className="input" value={form.name} onChange={set('name')} required minLength={3} maxLength={100} autoComplete="name" />
          </Field>
          <Field label="NIFT ID" required htmlFor="nid" help="Your unique NIFT student ID, e.g. FC/23/101. It cannot be changed later.">
            <input id="nid" className="input mono" value={form.niftId} onChange={set('niftId')} required placeholder="FC/23/101" autoCapitalize="characters" />
          </Field>
          <Field label="NIFT Email" help="Taken from your Google sign-in — cannot be changed.">
            <input className="input" value={user?.email || ''} readOnly />
          </Field>
          <Field label="Phone Number" required htmlFor="phone">
            <input id="phone" className="input" type="tel" value={form.phone} onChange={set('phone')} required placeholder="+91 98xxxxxxxx" autoComplete="tel" />
          </Field>
          <div className="grid grid-2">
            <Field label="Department" required htmlFor="dept">
              <select id="dept" className="select" value={form.department} onChange={set('department')} required>
                <option value="">Select…</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d} — {DEPARTMENT_NAMES[d]}</option>
                ))}
              </select>
            </Field>
            <Field label="Semester" required htmlFor="sem">
              <select id="sem" className="select" value={form.semester} onChange={set('semester')} required disabled={!form.department}>
                <option value="">Select…</option>
                {Array.from({ length: maxSem }, (_, i) => i + 1).map((s) => (
                  <option key={s} value={s}>Semester {s}</option>
                ))}
              </select>
            </Field>
          </div>
          <p className="tiny muted">
            Your student type (FC / FC-IDM / Other Department) is set by the FC Staff. Semesters update automatically
            each academic term.
          </p>
          <Alert kind="error">{error}</Alert>
          <div className="row-between">
            <button type="button" className="btn btn-ghost" onClick={signOut}>Sign out</button>
            <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Saving…' : 'Complete registration'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
