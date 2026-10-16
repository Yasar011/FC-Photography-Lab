import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from './lib/auth.jsx';
import { firebaseConfigured } from './firebase.js';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';

import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import StudentDashboard from './pages/StudentDashboard.jsx';
import BookLab from './pages/BookLab.jsx';
import MyBookings from './pages/MyBookings.jsx';
import BookingDetail from './pages/BookingDetail.jsx';
import FcApprovals from './pages/FcApprovals.jsx';
import ApprovalDetail from './pages/ApprovalDetail.jsx';
import Profile from './pages/Profile.jsx';
import FacultyResponse from './pages/FacultyResponse.jsx';
import PrintSheet from './pages/PrintSheet.jsx';

// Admin screens are split into their own chunk; students never download them.
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'));
const AdminCalendar = lazy(() => import('./pages/admin/AdminCalendar.jsx'));
const AdminBookings = lazy(() => import('./pages/admin/AdminBookings.jsx'));
const StaffBooking = lazy(() => import('./pages/admin/StaffBooking.jsx'));
const Students = lazy(() => import('./pages/admin/Students.jsx'));
const SpecialApprovals = lazy(() => import('./pages/admin/SpecialApprovals.jsx'));
const BookingApprovals = lazy(() => import('./pages/admin/BookingApprovals.jsx'));
const FacultyConcerns = lazy(() => import('./pages/admin/FacultyConcerns.jsx'));
const Availability = lazy(() => import('./pages/admin/Availability.jsx'));
const SettingsPage = lazy(() => import('./pages/admin/Settings.jsx'));
const Admins = lazy(() => import('./pages/admin/Admins.jsx'));
const AuditLog = lazy(() => import('./pages/admin/AuditLog.jsx'));
const EmailLog = lazy(() => import('./pages/admin/EmailLog.jsx'));

const RETURN_KEY = 'fc-return-to';

/** Signed-in gate. Remembers where the user was going (e.g. an email link). */
function RequireAuth({ children, allowUnregistered = false }) {
  const { user, loading, profile, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) {
    const target = location.pathname + location.search;
    try {
      if (target !== '/') sessionStorage.setItem(RETURN_KEY, target);
    } catch { /* storage unavailable */ }
    return <Navigate to="/login" replace state={{ from: target }} />;
  }
  if (!allowUnregistered && !profile?.niftId && !isAdmin) return <Navigate to="/register" replace />;
  return children;
}

function RequireRole({ roles, children }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) return <Navigate to="/" replace />;
  return children;
}

/** Student-only screens need a registered student profile (admins may not have one). */
function StudentOnly({ children }) {
  const { profile } = useAuth();
  if (!profile?.niftId) {
    return (
      <div className="card card-pad" style={{ maxWidth: 560 }}>
        <h2>Student profile required</h2>
        <p className="muted" style={{ margin: '8px 0 14px' }}>This page is for registered students.</p>
        <div className="row">
          <Link className="btn btn-primary" to="/register">Register as a student</Link>
          <Link className="btn" to="/admin">Admin dashboard</Link>
        </div>
      </div>
    );
  }
  return children;
}

function Home() {
  const { profile, isAdmin } = useAuth();
  if (isAdmin && !profile?.niftId) return <Navigate to="/admin" replace />;
  return <StudentDashboard />;
}

function AfterLogin() {
  // Return to a deep link (e.g. approval email) after signing in.
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Login />;
  let to = '/';
  try {
    to = sessionStorage.getItem(RETURN_KEY) || '/';
    sessionStorage.removeItem(RETURN_KEY);
  } catch { /* ignore */ }
  return <Navigate to={to} replace />;
}

const ALL_ADMINS = ['main', 'staff', 'fccc'];
const STAFF = ['main', 'staff'];
const MAIN = ['main'];

export default function App() {
  if (!firebaseConfigured) {
    return (
      <div className="center-screen">
        <div className="card card-pad" style={{ maxWidth: 520 }}>
          <h2>Firebase is not configured</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Copy <code>web/.env.example</code> to <code>web/.env.local</code>, fill in your Firebase web app
            configuration and restart the dev server. See README.md for the full setup.
          </p>
        </div>
      </div>
    );
  }
  const admin = (roles, el) => (
    <RequireRole roles={roles}>
      <Suspense fallback={<Loading />}>{el}</Suspense>
    </RequireRole>
  );
  return (
    <Routes>
      <Route path="/login" element={<AfterLogin />} />
      <Route path="/register" element={<RequireAuth allowUnregistered><Register /></RequireAuth>} />
      <Route path="/faculty/:bookingId" element={<RequireAuth allowUnregistered><FacultyResponse /></RequireAuth>} />
      <Route path="/print/:bookingId" element={<RequireAuth><PrintSheet /></RequireAuth>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="book" element={<StudentOnly><BookLab /></StudentOnly>} />
        <Route path="my-bookings" element={<StudentOnly><MyBookings /></StudentOnly>} />
        <Route path="bookings/:id" element={<BookingDetail />} />
        <Route path="approvals" element={<FcApprovals />} />
        <Route path="approvals/:id" element={<ApprovalDetail />} />
        <Route path="profile" element={<StudentOnly><Profile /></StudentOnly>} />
        <Route path="admin" element={admin(ALL_ADMINS, <AdminDashboard />)} />
        <Route path="admin/calendar" element={admin(ALL_ADMINS, <AdminCalendar />)} />
        <Route path="admin/bookings" element={admin(ALL_ADMINS, <AdminBookings />)} />
        <Route path="admin/special" element={admin(ALL_ADMINS, <SpecialApprovals />)} />
        <Route path="admin/approvals" element={admin(ALL_ADMINS, <BookingApprovals />)} />
        <Route path="admin/concerns" element={admin(ALL_ADMINS, <FacultyConcerns />)} />
        <Route path="admin/audit" element={admin(ALL_ADMINS, <AuditLog />)} />
        <Route path="admin/book" element={admin(STAFF, <StaffBooking />)} />
        <Route path="admin/students" element={admin(STAFF, <Students />)} />
        <Route path="admin/availability" element={admin(STAFF, <Availability />)} />
        <Route path="admin/emails" element={admin(STAFF, <EmailLog />)} />
        <Route path="admin/settings" element={admin(MAIN, <SettingsPage />)} />
        <Route path="admin/admins" element={admin(MAIN, <Admins />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
