import { useEffect, useState } from 'react';
import { orderByChild, limitToLast } from 'firebase/database';

import { useLiveList, dbQuery } from '../lib/hooks.js';
import { Modal } from '../components/ui.jsx';
import { DEMO_ACCOUNTS, accountByUid, currentUser, signInAs, onSessionChange } from './session.js';
import { resetDemo } from './store.js';
import { formatDateTime } from '@shared/calendar.js';

/** Floating demo toolbar: switch account, read the email outbox, reset data. */
export default function DemoBar() {
  const [user, setUser] = useState(currentUser());
  const [panel, setPanel] = useState(null);
  const [expanded, setExpanded] = useState(false); // phones: collapsed into the top bar
  useEffect(() => onSessionChange(setUser), []);
  // The guide opens by itself after the first sign-in, so new visitors know where to start.
  useEffect(() => {
    if (!user) return;
    try {
      if (localStorage.getItem('fc-demo-guide-seen')) return;
      localStorage.setItem('fc-demo-guide-seen', '1');
      setPanel('guide');
    } catch { /* ignore */ }
  }, [user]);
  if (!user) return null;

  return (
    <>
      <div className={`demo-bar no-print ${expanded ? 'expanded' : ''}`} role="region" aria-label="Demo controls">
        <button className="demo-tag" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>DEMO</button>
        <span className="demo-who">{user.name}</span>
        <button className="demo-guide-btn" onClick={() => { setPanel('guide'); setExpanded(false); }}>Guide</button>
        <button onClick={() => { setPanel('switch'); setExpanded(false); }}>Switch account</button>
        <button onClick={() => { setPanel('outbox'); setExpanded(false); }}>Email outbox</button>
        <button onClick={() => window.open(window.location.href, '_blank')}>New tab</button>
      </div>
      {panel === 'switch' && <SwitchAccount current={user} onClose={() => setPanel(null)} />}
      {panel === 'outbox' && <Outbox onClose={() => setPanel(null)} />}
      {panel === 'guide' && <Guide current={user} onClose={() => setPanel(null)} />}
    </>
  );
}

function SwitchAccount({ current, onClose }) {
  return (
    <Modal
      title="Switch demo account"
      onClose={onClose}
      footer={
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('Reset all demo data? Bookings you created will be removed and the sample data recreated.')) {
              resetDemo();
              window.location.reload();
            }
          }}
        >
          Reset demo data
        </button>
      }
    >
      <p className="small muted">Each browser tab keeps its own account. All tabs share the same live database.</p>
      <div className="stack" style={{ gap: 6 }}>
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.uid}
            className={`btn ${a.uid === current.uid ? 'btn-primary' : ''}`}
            style={{ justifyContent: 'space-between', height: 'auto', padding: '8px 12px' }}
            onClick={() => {
              signInAs(a.uid);
              window.location.hash = '#/';
              onClose();
            }}
          >
            <span style={{ textAlign: 'left' }}>
              <div>{a.name}</div>
              <div className="tiny" style={{ opacity: 0.7, fontWeight: 400 }}>{a.label}</div>
            </span>
            {a.uid === current.uid && <span className="tiny">current</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function Outbox({ onClose }) {
  const { items } = useLiveList(dbQuery('demoOutbox', orderByChild('at'), limitToLast(100)), []);
  const mails = [...items].reverse();
  const [open, setOpen] = useState(null);
  const mail = mails.find((m) => m.id === open);
  return (
    <Modal title="Email outbox (demo)" onClose={onClose}>
      <p className="small muted">
        In production these are sent by Cloud Functions over SMTP. Here they are captured so you can read them — links
        work (e.g. “Review approval request”, “I DID NOT APPROVE THIS”).
      </p>
      {mail ? (
        <div className="stack">
          <button className="btn btn-sm" onClick={() => setOpen(null)}>← All emails</button>
          <div className="small">
            <div><b>To:</b> {mail.to}</div>
            <div><b>Subject:</b> {mail.subject}</div>
          </div>
          <iframe
            title={mail.subject}
            sandbox="allow-top-navigation-by-user-activation allow-popups"
            style={{ width: '100%', height: 460, border: '1px solid var(--line)', borderRadius: 6, background: '#fff' }}
            srcDoc={mail.html.replace('<head>', '<head><base target="_top">').replace('<html>', '<html><head><base target="_top"></head>')}
          />
        </div>
      ) : mails.length === 0 ? (
        <p className="muted">No emails yet.</p>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          {mails.map((m) => (
            <button key={m.id} className="btn" style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 12px', textAlign: 'left' }} onClick={() => setOpen(m.id)}>
              <span>
                <div style={{ fontWeight: 600 }}>{m.subject}</div>
                <div className="tiny muted" style={{ fontWeight: 400 }}>To {m.to} · {formatDateTime(m.at)}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Every sample booking, what it shows, and one click to see it as the right person. */
function Guide({ current, onClose }) {
  const { items } = useLiveList(dbQuery('demoGuide', orderByChild('order')), []);
  const groups = [];
  for (const g of [...items].sort((a, b) => a.order - b.order)) {
    let grp = groups.find((x) => x.name === g.group);
    if (!grp) groups.push((grp = { name: g.group, items: [] }));
    grp.items.push(g);
  }
  const open = (g) => {
    if (g.signInAs && g.signInAs !== current.uid) signInAs(g.signInAs);
    window.location.hash = g.bookingId ? `#/bookings/${g.bookingId}` : '#/';
    onClose();
  };
  return (
    <Modal title="Demo guide — every example booking" onClose={onClose}>
      <p className="small muted">
        Click an example to open it as the right person. Use <b>Switch account</b> to go back, or <b>New tab</b> to watch two
        people at once — both tabs update live.
      </p>
      <div className="stack" style={{ gap: 14 }}>
        {groups.map((grp) => (
          <div key={grp.name}>
            <div className="tiny" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 6 }}>{grp.name}</div>
            <div className="stack" style={{ gap: 6 }}>
              {grp.items.map((g) => {
                const who = accountByUid(g.signInAs);
                return (
                  <button key={g.id || g.order} className="btn" style={{ justifyContent: 'flex-start', height: 'auto', padding: '10px 12px', textAlign: 'left' }} onClick={() => open(g)}>
                    <span style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{g.title}</div>
                      <div className="tiny" style={{ fontWeight: 400, opacity: 0.8, marginTop: 2 }}>{g.text}</div>
                      <div className="tiny" style={{ fontWeight: 600, color: 'var(--primary)', marginTop: 4 }}>
                        {g.bookingId ? `${g.bookingId} · ` : ''}Open as {who?.name || 'current account'}
                      </div>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!items.length && <p className="muted">Loading…</p>}
      </div>
    </Modal>
  );
}
