// Demo sign-in. Each browser tab has its own signed-in account (sessionStorage),
// while all tabs share one database — open two tabs as different users to
// watch bookings update in real time.

export const DEMO_ACCOUNTS = [
  { uid: 'demo-fc', name: 'Aarav Mehta', email: 'aarav.mehta@nift.ac.in', group: 'Students', label: 'FC Student · Sem 6',
    profile: { niftId: 'FC/23/014', department: 'FC', semester: 6, phone: '+91 98290 11402' } },
  { uid: 'demo-fc2', name: 'Neha Verma', email: 'neha.verma@nift.ac.in', group: 'Students', label: 'FC Student · Sem 4',
    profile: { niftId: 'FC/24/022', department: 'FC', semester: 4, phone: '+91 94140 22871' } },
  { uid: 'demo-other', name: 'Riya Sharma', email: 'riya.sharma@nift.ac.in', group: 'Students', label: 'Other Department (BFT) · Sem 6',
    profile: { niftId: 'BFT/23/041', department: 'BFT', semester: 6, phone: '+91 99280 33190' } },
  { uid: 'demo-idm', name: 'Ishaan Kapoor', email: 'ishaan.kapoor@nift.ac.in', group: 'Students', label: 'FC-IDM Student · Sem 6',
    profile: { niftId: 'FC/23/030', department: 'FC', semester: 6, phone: '+91 97830 55021' } },
  { uid: 'demo-first', name: 'Kabir Singh', email: 'kabir.singh@nift.ac.in', group: 'Students', label: 'First-year FC Student · Sem 1',
    profile: { niftId: 'FC/26/007', department: 'FC', semester: 1, phone: '+91 90010 77812' } },
  { uid: 'demo-grad', name: 'Tanya Rathore', email: 'tanya.rathore@nift.ac.in', group: 'Students', label: 'Graduated FC Student',
    profile: { niftId: 'FC/22/011', department: 'FC', semester: 8, phone: '+91 93520 66043' } },
  { uid: 'demo-fd', name: 'Sneha Joshi', email: 'sneha.joshi@nift.ac.in', group: 'Students', label: 'Other Department (FD) · Sem 6',
    profile: { niftId: 'FD/23/055', department: 'FD', semester: 6, phone: '+91 98870 41256' } },
  { uid: 'demo-ad', name: 'Rohan Gupta', email: 'rohan.gupta@nift.ac.in', group: 'Students', label: 'Other Department (AD) · Sem 4',
    profile: { niftId: 'AD/24/018', department: 'AD', semester: 4, phone: '+91 97720 18834' } },
  { uid: 'demo-td', name: 'Priya Nair', email: 'priya.nair@nift.ac.in', group: 'Students', label: 'First-year Other Department (TD) · Sem 1',
    profile: { niftId: 'TD/26/009', department: 'TD', semester: 1, phone: '+91 96600 90215' } },
  { uid: 'demo-mfm', name: 'Arjun Mehra', email: 'arjun.mehra@nift.ac.in', group: 'Students', label: 'Other Department (MFM) · Sem 3',
    profile: { niftId: 'MFM/25/004', department: 'MFM', semester: 3, phone: '+91 99820 40407' } },
  { uid: 'demo-fc3', name: 'Meghna Das', email: 'meghna.das@nift.ac.in', group: 'Students', label: 'FC Student · Sem 7 (cancelled → blocked)',
    profile: { niftId: 'FC/23/031', department: 'FC', semester: 7, phone: '+91 94130 31877' } },
  { uid: 'demo-staff', name: 'Prakash Choudhary', email: 'prakash.choudhary@nift.ac.in', group: 'Admins', label: 'Staff Admin (FC Assistant)', role: 'staff' },
  { uid: 'demo-fccc', name: 'Prof. Meera Iyer', email: 'meera.iyer@nift.ac.in', group: 'Admins', label: 'FC-CC Admin', role: 'fccc' },
  { uid: 'demo-main', name: 'Dr. Kavita Joshi', email: 'fc.coordinator@nift.ac.in', group: 'Admins', label: 'Main Admin', role: 'main' },
  { uid: 'demo-faculty', name: 'Dr. Anjali Rao', email: 'anjali.rao@nift.ac.in', group: 'Others', label: 'Faculty — receives booking notices' },
  { uid: 'demo-new', name: 'New Student', email: 'new.student@nift.ac.in', group: 'Others', label: 'First sign-in → registration form' },
];

const KEY = 'fc-demo-session'; // per tab (sessionStorage)
const LAST = 'fc-demo-last'; // last account used in any tab (localStorage) — new tabs start with it
const listeners = new Set();

export function accountByUid(uid) {
  return DEMO_ACCOUNTS.find((a) => a.uid === uid) || null;
}

export function currentUser() {
  try {
    let uid = sessionStorage.getItem(KEY);
    if (!uid) {
      uid = localStorage.getItem(LAST);
      if (uid) sessionStorage.setItem(KEY, uid);
    }
    return accountByUid(uid);
  } catch {
    return null;
  }
}

export function signInAs(uid) {
  try {
    sessionStorage.setItem(KEY, uid);
    localStorage.setItem(LAST, uid);
  } catch { /* ignore */ }
  listeners.forEach((cb) => cb(currentUser()));
}

export function signOutDemo() {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(LAST);
  } catch { /* ignore */ }
  listeners.forEach((cb) => cb(null));
}

export function onSessionChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
