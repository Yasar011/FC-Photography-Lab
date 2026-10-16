import { useState } from 'react';

import { useAuth } from '../../lib/auth.jsx';
import { useLive } from '../../lib/hooks.js';
import { call } from '../../firebase.js';
import { PageHead, Field, Alert, Empty, ConfirmModal, useToast } from '../../components/ui.jsx';
import { ROLE_LABELS, ROLES } from '@shared/constants.js';
import { formatDateTime } from '@shared/calendar.js';
import { ALLOWED_DOMAIN } from '../../firebase.js';

const ROLE_HELP = {
  main: 'Full control: admins, roles, rules, questions, all bookings, settings.',
  staff: 'Calendar, bookings for students, open/block slots, holidays, student records, regular bookings.',
  fccc: 'Review FC bookings, approve special bookings, final FC approval.',
};

export default function Admins() {
  const { user } = useAuth();
  const { value: admins } = useLive('admins', []);
  const { value: invites } = useLive('adminInvites', []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(ROLES.STAFF);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const toast = useToast();

  const assign = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await call('setAdminRole', { email: email.trim(), role });
      toast(r.pending ? 'Invite saved — role applies on first sign-in' : 'Role assigned', 'ok');
      setEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const list = Object.entries(admins || {}).map(([uid, a]) => ({ uid, ...a })).sort((a, b) => a.role.localeCompare(b.role));
  const pending = Object.values(invites || {});

  return (
    <>
      <PageHead eyebrow="Main Admin" title="Admins & roles" />
      <div className="split">
        <div className="stack-lg">
          <section className="card">
            <div className="card-head"><h2>Administrators</h2></div>
            {list.length === 0 ? <Empty title="No admins" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name / email</th><th>Role</th><th>Added</th><th /></tr></thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.uid}>
                        <td><div style={{ fontWeight: 600 }}>{a.name}{a.uid === user.uid ? ' (you)' : ''}</div><div className="small muted">{a.email}</div></td>
                        <td>
                          <select
                            className="select"
                            style={{ height: 32, width: 'auto' }}
                            value={a.role}
                            onChange={(e) => setDialog({
                              title: 'Change role',
                              message: `Change ${a.email} to ${ROLE_LABELS[e.target.value]}?`,
                              confirmLabel: 'Change role',
                              onConfirm: async () => { await call('setAdminRole', { email: a.email, role: e.target.value }); toast('Role updated', 'ok'); },
                            })}
                          >
                            {Object.values(ROLES).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                        </td>
                        <td className="small">{formatDateTime(a.addedAt)}<div className="muted">by {a.addedBy}</div></td>
                        <td>
                          <button className="btn btn-sm btn-danger" onClick={() => setDialog({
                            title: 'Remove admin access',
                            message: `Remove all admin access for ${a.email}? Their student profile (if any) is kept.`,
                            confirmLabel: 'Remove',
                            tone: 'danger',
                            onConfirm: async () => { await call('setAdminRole', { email: a.email, role: null }); toast('Admin removed', 'ok'); },
                          })}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {pending.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>Pending invites</h2></div>
              <div className="card-body stack">
                {pending.map((i) => (
                  <div key={i.email} className="row-between">
                    <span>{i.email} — <b>{ROLE_LABELS[i.role]}</b> <span className="small muted">by {i.invitedByName}</span></span>
                    <button className="btn btn-sm btn-ghost" onClick={() => call('setAdminRole', { email: i.email, role: null }).then(() => toast('Invite removed', 'ok'))}>Revoke</button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <form className="card" onSubmit={assign}>
          <div className="card-head"><h2>Add admin</h2></div>
          <div className="card-body stack">
            <Field label="NIFT email" required help="If they have not signed in yet, the role is applied on their first sign-in.">
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${ALLOWED_DOMAIN}`} required />
            </Field>
            <Field label="Role">
              <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                {Object.values(ROLES).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
            <p className="small muted">{ROLE_HELP[role]}</p>
            <Alert kind="error">{error}</Alert>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Assign role'}</button>
          </div>
        </form>
      </div>
      {dialog && <ConfirmModal {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
