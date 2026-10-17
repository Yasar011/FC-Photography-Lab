import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
} from 'firebase/auth';
import { ref, onValue } from 'firebase/database';

import { auth, db, googleProvider, call, ALLOWED_DOMAIN, CLIENT_BACKEND } from '../firebase.js';
import { withRuleDefaults } from '@shared/defaults.js';
import { STUDENT_TYPES } from '@shared/constants.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [synced, setSynced] = useState(false);
  const [role, setRole] = useState(undefined); // undefined = not loaded yet
  const [profile, setProfile] = useState(undefined);
  const [settings, setSettings] = useState(null);
  const [equipment, setEquipment] = useState(null);
  const [error, setError] = useState('');

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setSynced(false);
        setProfile(undefined);
        setRole(undefined);
        if (!u) {
          setUser(null);
          return;
        }
        const email = (u.email || '').toLowerCase();
        if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
          setError(`Please sign in with your NIFT Google account (@${ALLOWED_DOMAIN}). ${email} is not allowed.`);
          await fbSignOut(auth);
          return;
        }
        setError('');
        setUser(u);
        try {
          await call('syncAccount');
        } catch (err) {
          setError(err.message);
        }
        setSynced(true);
      }),
    [],
  );

  // Live profile, role and configuration once signed in.
  useEffect(() => {
    if (!user || !synced) return undefined;
    const offs = [
      onValue(ref(db, `users/${user.uid}`), (s) => setProfile(s.val()), () => setProfile(null)),
      onValue(ref(db, `roles/${user.uid}/role`), (s) => setRole(s.val()), () => setRole(null)),
      onValue(ref(db, 'settings'), (s) => setSettings(s.val() || {}), () => setSettings({})),
      onValue(ref(db, 'equipment'), (s) => setEquipment(s.val() || {}), () => setEquipment({})),
    ];
    return () => offs.forEach((off) => off());
  }, [user, synced]);

  // Spark plan: admins' browsers run the automatic jobs (complete / expire
  // bookings, semester progression, clean up old data when the database fills).
  useEffect(() => {
    if (!CLIENT_BACKEND || !user || !role) return undefined;
    let stop = null;
    import('@backend').then((m) => {
      m.startAdminJobs(role);
      stop = m.stopAdminJobs;
    });
    return () => stop?.();
  }, [user, role]);

  const value = useMemo(() => {
    // Routing waits for profile AND role, so admins without a student profile
    // are never bounced to the registration form.
    const ready = user === null || (user && synced && profile !== undefined && role !== undefined && settings !== null);
    return {
      loading: user === undefined || !ready,
      user,
      role: role || null,
      profile,
      isAdmin: Boolean(role),
      isMain: role === 'main',
      isStaff: role === 'main' || role === 'staff',
      isFccc: role === 'main' || role === 'fccc',
      isFcStudent: profile?.studentType === STUDENT_TYPES.FC,
      settings: settings || {},
      rules: withRuleDefaults(settings?.bookingRules),
      equipment: equipment || {},
      error,
      setError,
      async signIn() {
        setError('');
        try {
          await signInWithPopup(auth, googleProvider);
        } catch (err) {
          if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
            await signInWithRedirect(auth, googleProvider);
          } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
            setError(err.message);
          }
        }
      },
      signOut: () => {
        try {
          sessionStorage.removeItem('fc-return-to');
        } catch { /* ignore */ }
        return fbSignOut(auth);
      },
    };
  }, [user, synced, role, profile, settings, equipment, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
