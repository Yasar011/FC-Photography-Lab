import { DEMO_ACCOUNTS, signInAs } from './session.js';

/** Replaces "Continue with Google" in demo mode. */
export default function DemoLogin() {
  const groups = ['Students', 'Admins', 'Others'];
  return (
    <div className="stack">
      <div className="alert alert-info small">
        <span>
          <b>Demo mode.</b> Everything runs in this browser with sample data — no Firebase project needed. Pick an account
          to sign in. Open a second tab as another user to watch bookings update live.
        </span>
      </div>
      {groups.map((g) => (
        <div key={g} className="stack" style={{ gap: 6 }}>
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{g}</div>
          {DEMO_ACCOUNTS.filter((a) => a.group === g).map((a) => (
            <button key={a.uid} className="gbtn" style={{ justifyContent: 'space-between', padding: '0 14px', height: 'auto', minHeight: 52 }} onClick={() => signInAs(a.uid)}>
              <span style={{ textAlign: 'left' }}>
                <div>{a.name}</div>
                <div className="tiny muted" style={{ fontWeight: 400 }}>{a.label} · {a.email}</div>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
