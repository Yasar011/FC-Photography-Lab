import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { orderByChild, equalTo } from 'firebase/database';

import { useAuth } from '../lib/auth.jsx';
import { useLive, dbQuery } from '../lib/hooks.js';
import { ROLE_LABELS, STATUS, STUDENT_TYPE_LABELS, FC_APPROVAL_STATE } from '@shared/constants.js';
import { Camera } from './ui.jsx';
import Icon, { PlusColor } from './Icon.jsx';
import { MySignatureModal } from './SignApprove.jsx';

function useCount(path, child, value, enabled) {
  const q = enabled ? dbQuery(path, orderByChild(child), equalTo(value)) : null;
  const { value: v } = useLive(q, [enabled, path, child, value]);
  return v ? Object.keys(v).length : 0;
}

const initials = (name = '') => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(Dr|Prof|Mr|Ms|Mrs)\.?$/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function Item({ to, icon, children, count, hot, end }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <Icon name={icon} />
      <span>{children}</span>
      {count ? <span className={`count ${hot ? 'hot' : ''}`}>{count}</span> : null}
    </NavLink>
  );
}

export default function Layout() {
  const { profile, role, isAdmin, isStaff, isMain, isFcStudent, user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const menuRef = useRef(null);
  const location = useLocation();
  useEffect(() => {
    setMobileOpen(false);
    setMenu(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const special = useCount('bookings', 'status', STATUS.PENDING_SPECIAL_APPROVAL, isAdmin);
  const concerns = useCount('bookings', 'status', STATUS.FACULTY_CONCERN, isAdmin);
  const fcccPending = useCount('bookings', 'status', STATUS.PENDING_FCCC_APPROVAL, isAdmin);
  const fcQ = profile?.niftId ? dbQuery('fcApprovals', orderByChild('fcStudentUid'), equalTo(user.uid)) : null;
  const { value: fcMine } = useLive(fcQ, [profile?.niftId, user?.uid]);
  const fcPending = Object.values(fcMine || {}).filter((a) => a.state === FC_APPROVAL_STATE.PENDING).length;
  const isStudent = Boolean(profile?.niftId);
  const displayName = profile?.name || user?.displayName || user?.email;

  const toggleNav = () => (window.matchMedia('(max-width: 960px)').matches ? setMobileOpen((x) => !x) : setCollapsed((x) => !x));

  return (
    <>
      <header className="appbar">
        <button className="icon-btn" onClick={toggleNav} aria-label="Main menu">
          <Icon name="menu" />
          {fcPending + special + concerns + fcccPending > 0 && <span className="dot">{fcPending + special + concerns + fcccPending}</span>}
        </button>
        <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
          <span className="brand-mark"><Camera /></span>
          <span>
            <div className="brand-name">FC Photography Lab</div>
            <div className="brand-sub">NIFT Jodhpur · Booking & Permissions</div>
          </span>
        </Link>
        <span className="spacer" />
        <span className="role-chip">{role ? ROLE_LABELS[role] : STUDENT_TYPE_LABELS[profile?.studentType] || 'Student'}</span>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="Account" aria-expanded={menu}>
            <span className="avatar">{initials(displayName)}</span>
          </button>
          {menu && (
            <div className="menu" role="menu">
              <span className="avatar lg">{initials(displayName)}</span>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{displayName}</div>
              <div className="small muted">{user?.email}</div>
              {profile?.niftId && <div className="small mono">{profile.niftId} · {profile.department} · Sem {profile.semester}</div>}
              <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
                {isStudent && <Link className="btn btn-sm" to="/profile">Profile</Link>}
                {isAdmin && <button className="btn btn-sm" onClick={() => { setSigOpen(true); setMenu(false); }}><Icon name="stamp" /> My signature</button>}
                <button className="btn btn-sm" onClick={signOut}><Icon name="logout" /> Sign out</button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className={`app-body ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="scrim" onClick={() => setMobileOpen(false)} />
        <aside className="sidenav" aria-label="Navigation">
          {isStudent ? (
            <Link to="/book" className="create-btn"><PlusColor /> Book the lab</Link>
          ) : isStaff ? (
            <Link to="/admin/book" className="create-btn"><PlusColor /> Book for student</Link>
          ) : null}

          {isStudent && (
            <>
              <Item to="/" icon="home" end>Home</Item>
              <Item to="/book" icon="calendar">Lab calendar</Item>
              <Item to="/my-bookings" icon="list">My bookings</Item>
              {(isFcStudent || Object.keys(fcMine || {}).length > 0) && (
                <Item to="/approvals" icon="checkCircle" count={fcPending} hot>My FC approvals</Item>
              )}
              <Item to="/profile" icon="user">Profile</Item>
            </>
          )}

          {isAdmin && (
            <>
              <div className="nav-label">{ROLE_LABELS[role]}</div>
              <Item to="/admin" icon="home" end>Dashboard</Item>
              <Item to="/admin/calendar" icon="calendar">Lab calendar</Item>
              <Item to="/admin/special" icon="stamp" count={special} hot>Special approvals</Item>
              <Item to="/admin/approvals" icon="checkCircle" count={fcccPending} hot>Approvals</Item>
              <Item to="/admin/concerns" icon="flag" count={concerns} hot>Faculty concerns</Item>
              <Item to="/admin/bookings" icon="list">All bookings</Item>
              {isStaff && <Item to="/admin/students" icon="users">Students</Item>}
              {isStaff && <Item to="/admin/availability" icon="sun">Holidays & overrides</Item>}
              {isStaff && <Item to="/admin/emails" icon="mail">Email log</Item>}
              <Item to="/admin/audit" icon="history">Audit log</Item>
              {isMain && (
                <>
                  <div className="nav-label">System</div>
                  <Item to="/admin/settings" icon="settings">Rules & questions</Item>
                  <Item to="/admin/admins" icon="shield">Admins & roles</Item>
                </>
              )}
            </>
          )}
        </aside>
        <div className="main">
          <main className="page">
            <Outlet />
          </main>
        </div>
      </div>
      {sigOpen && <MySignatureModal onClose={() => setSigOpen(false)} />}
    </>
  );
}
