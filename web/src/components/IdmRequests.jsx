import { useMemo } from 'react';
import { orderByChild, equalTo } from 'firebase/database';

import { useLive, dbQuery } from '../lib/hooks.js';
import { call } from '../firebase.js';
import { useActionDialog } from './SignApprove.jsx';
import { formatDateTime } from '@shared/calendar.js';

/**
 * FC-IDM requests (Admin Dashboard): other-department students who ticked
 * "I am an FC-IDM student" at registration. FC staff confirm or reject here —
 * no emails are sent.
 */
export default function IdmRequests() {
  const q = useMemo(() => dbQuery('users', orderByChild('idmRequest/state'), equalTo('PENDING')), []);
  const { value } = useLive(q, [q]);
  const [ask, dialogNode] = useActionDialog();
  const requests = Object.values(value || {}).filter((u) => u.niftId).sort((a, b) => (a.idmRequest?.at || 0) - (b.idmRequest?.at || 0));
  if (!requests.length) return null;

  const decide = (u, decision) => ask({
    title: decision === 'approve' ? `Confirm ${u.name} as FC-IDM` : `Reject FC-IDM — ${u.name}`,
    message: decision === 'approve'
      ? `${u.name} (${u.niftId}, ${u.department}) becomes an FC-IDM student.`
      : `${u.name} stays an other-department student.`,
    confirmLabel: decision === 'approve' ? 'Confirm FC-IDM' : 'Reject',
    tone: decision === 'approve' ? 'primary' : 'danger',
    remarks: 'optional',
    remarksLabel: 'Note (optional)',
    onConfirm: async (remarks) => {
      await call('updateStudent', { niftId: u.niftId, idmDecision: decision, remarks });
      return decision === 'approve' ? 'Confirmed as FC-IDM' : 'Request rejected';
    },
  });

  return (
    <section className="card">
      <div className="card-head">
        <h2>FC-IDM requests <span className="tab-n hot">{requests.length}</span></h2>
        <span className="small muted">Check they really are FC-IDM students</span>
      </div>
      <div className="appr-list" style={{ border: 0, borderRadius: 0 }}>
        {requests.map((u) => (
          <div key={u.uid} className="appr-row">
            <div className="appr-when"><b>{u.niftId}</b><span>{u.department} · Sem {u.semester}</span></div>
            <div className="appr-main">
              <div className="appr-name">{u.name}</div>
              <div className="small muted">{u.email} · {u.phone} · asked {formatDateTime(u.idmRequest.at)}</div>
            </div>
            <div className="appr-actions row" style={{ gap: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={() => decide(u, 'approve')}>Confirm FC-IDM</button>
              <button className="btn btn-sm btn-danger" onClick={() => decide(u, 'reject')}>Reject</button>
            </div>
          </div>
        ))}
      </div>
      {dialogNode}
    </section>
  );
}
