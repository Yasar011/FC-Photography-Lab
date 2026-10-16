import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { useMyFcApprovals } from '../lib/bookings.js';
import { PageHead, Empty, Alert } from '../components/ui.jsx';
import { ApprovalCard } from './ApprovalDetail.jsx';
import { FC_APPROVAL_STATE } from '@shared/constants.js';

export default function FcApprovals() {
  const { user, isFcStudent } = useAuth();
  const { items, loading } = useMyFcApprovals(user.uid);
  const [tab, setTab] = useState('pending');
  const pending = items.filter((a) => a.state === FC_APPROVAL_STATE.PENDING);
  const done = items.filter((a) => a.state !== FC_APPROVAL_STATE.PENDING);
  const shown = tab === 'pending' ? pending : done;

  return (
    <>
      <PageHead
        eyebrow="FC students"
        title="My FC Approvals"
        sub="Other-department students who name you as the FC student involved need your approval."
      >
        <span className="live-dot">Live</span>
      </PageHead>
      {!isFcStudent && items.length === 0 && (
        <Alert kind="info">Approval requests are only sent to students classified as FC Students by the FC Staff.</Alert>
      )}
      <div className="tabs">
        <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>Pending ({pending.length})</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Approval history ({done.length})</button>
      </div>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="card"><Empty title={tab === 'pending' ? 'No pending requests' : 'No history yet'} /></div>
      ) : (
        <div className="stack">
          {shown.map((a) => (
            <ApprovalCard key={a.id} a={a} footer={<Link className="btn btn-sm" to={`/approvals/${a.id}`}>Open</Link>} />
          ))}
        </div>
      )}
    </>
  );
}
