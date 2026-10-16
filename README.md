# FC Photography Lab — Booking & Permission System
**NIFT Jodhpur · Fashion Communication**

A real-time booking and permission system for the FC Photography Lab. It's built on Firebase: Authentication (Google), Realtime Database, Storage, Cloud Functions and Hosting.

```
F:\FC
├── firebase.json            Hosting / Functions / Database / Storage / emulator config
├── database.rules.json      Strict RTDB rules — ALL client writes are denied
├── storage.rules            Storage is private (signatures served by functions)
├── functions/               Cloud Functions (Node 22, ESM) — the only writer
│   ├── shared/              Booking rules shared with the web UI (single source)
│   │   ├── constants.js     Departments, statuses, roles, NIFT ID helpers
│   │   ├── defaults.js      Default rules / questions / declaration / equipment
│   │   ├── calendar.js      Slot classification, override priority, ranges
│   │   └── academic.js      Semester progression & graduation logic
│   ├── src/                 Callable + scheduled functions
│   └── test/                node:test unit tests for the shared rules
└── web/                     React + Vite single-page app
```

---

## How the important rules are enforced

| Rule | Where it is enforced |
|---|---|
| Only verified `@nift.ac.in` Google accounts | `database.rules.json` (every read rule checks `email_verified` + domain) and `getActor()` in every function |
| NIFT ID is unique, UID is the identity | `registerStudent` claims `/students/{niftKey}` in a **transaction**; email is copied from the Google token and is never user-editable |
| Students cannot change type, semester, status or bookings | Rules deny **all** client writes. Every change goes through a callable function that checks the caller's role |
| One slot = one active booking | `createBooking` claims every hour in `/bookingSlots/{date}` inside **one RTDB transaction**. If two students submit at once, exactly one transaction commits. The other gets *"This slot has just been booked by another student. Please select another available time."* |
| Admin overrides never double-book | Priority order is booking → block → open → normal rules (`classifySlot`). Blocks use write-then-verify against bookings. New bookings re-check blocks and holidays after claiming, so the two can never both succeed |
| Max hours (FC students 4 h, others 3 h), faculty name & email required, 7-day window, CLS hours, after-10 PM / weekend / holiday | `evaluateRange()` in `functions/shared/calendar.js`. It runs on the server for every booking; the UI uses the same code for the live calendar |
| First-year (Sem 1–2) needs a senior | Server checks that the senior is registered, active and in Sem ≥ 3 |
| Other Department → FC student approval | Server checks the named FC student is classified as FC Student. The FC student approves from their own account via `respondFcApproval`. The claim is transactional, so a double click can't approve twice |
| FC students need no FC or faculty approval | `needsFcApproval()`. The faculty email is informational only |
| Faculty "I DID NOT APPROVE THIS" | Signed link token (only its SHA-256 hash is stored) **plus** Google sign-in as the faculty email → `FACULTY_CONCERN`. The booking is never auto-cancelled |
| Digital signatures | The student signs when booking. Admins save a signature once (account menu → *My signature*), and each approval stores its own copy (`approvalSignatures/…`). FC-CC final approvals **require** a signature. A photo of the Director-signed paper form can be attached. `getBookingSignatures` returns every signature to the student, FC student and admins (and no one else) |
| Cancelling blocks new bookings | When a student cancels their own booking, they can't make a new booking for **4 days** (`cancelCooldownDays`, 0 = off). The cancel dialog warns first. While blocked, booking is hidden and the student sees *"As you cancelled booking FC-…, you can't book until …"*. FC-CC cancellations and rejections don't block. Staff can still book for the student and can lift the block (Students → View → *Allow booking now*) |
| Expired requests | Pending bookings whose time has passed without approval are closed by the scheduled job as *Rejected — expired*; the slot is released, open FC requests are cancelled and the student is emailed |
| Special approval (paper form) | After 10 PM, weekend or holiday. **FC student:** FC Lab Assistant prints the form → Director's PA → Director signs → FC-CC approves & signs digitally. **Other departments:** FC Lab Assistant prints → **Dept CC (e.g. FD CC) or subject faculty** → Director's PA → Director → FC-CC. Paper signatures are verified by the FC-CC at final approval. **After the Director and FC-CC have signed, the student gives the form to the Admin Guard** |
| **FC-CC approval for everything** | Nothing is confirmed without the FC-CC. Normal bookings: student books & signs → (other departments: FC student approves) → **FC-CC signs & approves** (digital signature) → confirmed. Special bookings end with the FC-CC's final approval. Staff-made bookings also wait for the FC-CC. Only FC-CC / Main Admin can approve or decide faculty concerns; the FC Lab Assistant prints special forms and can reject or cancel. The FC-CC gets an "Approval Needed" email. No printing is needed for normal bookings |
| Graduated students can't book; history is kept | `accountBlockReason()`. Nothing is ever deleted — bookings, approvals, signatures, history and audit logs stay |
| Signatures | PNG uploaded by the function to Storage `signatures/{bookingId}.png`. Storage rules deny all clients; `getSignature` serves it only to the owner, the assigned FC student or admins |
| Email credentials | SMTP password is a Secret Manager secret used only inside Cloud Functions |

### Booking statuses
`SUBMITTED → PENDING_FC_APPROVAL → FC_APPROVED → PENDING_SPECIAL_APPROVAL → APPROVED → COMPLETED`, plus `FACULTY_CONCERN`, `REJECTED`, `CANCELLED_BY_STUDENT` and `CANCELLED_BY_ADMIN`. Every change is appended to `bookings/{id}/history` and to `/auditLogs`. `completeBookings` runs every 15 minutes and moves past `APPROVED` bookings to `COMPLETED`.

### Automatic semesters
`academicScheduler` runs daily at 00:20 IST:
- **1 Jan**: odd semesters advance (1→2, 3→4, 5→6, 7→8).
- **1 Jun**: final semester (8, or 4 for MFM) → **Graduated**, booking access off.
- **1 Aug**: even semesters advance (2→3, 4→5, 6→7).

Each event runs once per year; the run is recorded in `settings/academicCalendar/lastRuns`. A missed run is still applied within a 14-day catch-up window. The dates are editable, and the Main Admin can preview and run each event manually under **Rules & Questions → Academic calendar**.

### Database layout
```
/users/{uid}                 profile (email from Google, NIFT ID, dept, sem, type, status)
/students/{niftKey}          NIFT ID → uid registry (uniqueness)   e.g. BFT/23/101 → BFT_23_101
/bookings/{bookingId}        full booking record incl. history, approvals, signature ref
/bookingSlots/{date}/{hHH}   { bookingId, status, uid } — the atomic slot lock (public, no PII)
/fcApprovals/{id}            FC student approval requests
/approvals/{id}              log of every approval decision
/facultyNotifications/{id}   faculty notice + response (token hash only)
/roles/{uid}, /admins/{uid}, /adminInvites/{emailKey}
/settings/bookingRules | questions | declaration | instructions | academicCalendar
/settings/holidays/{date}    /settings/availabilityOverrides/{date}/{hHH}
/equipment/{id}              requirement checkboxes (CLS Class Room asks for a reason)
/auditLogs/{id}  /emailLogs/{id}  /counters/bookingIds/{yyyymmdd}
```

---

## Demo mode (no Firebase needed)

```bash
cd web
npm install
npm run demo          # http://localhost:5174
```

Demo mode runs the entire system in the browser:
- The **real Cloud Functions code** (`functions/src`) runs in the page against an in-browser Realtime Database. Vite swaps `firebase-admin`, `firebase-functions` and the Firebase web SDK for small shims in `web/src/demo/shims`. Every rule, transaction, status change, audit entry and email is produced by the production code.
- Sample data is seeded by calling those functions as each user. That gives you approved, pending-FC, pending-special, faculty-concern and cancelled bookings, plus a holiday, an opened class slot and a blocked slot.
- The sign-in page lists demo accounts for every role: FC student, other-department student, FC-IDM, first-year, graduated, Staff Admin, FC-CC, Main Admin, faculty, and a brand-new user who sees the registration form.
- The **DEMO** toolbar switches account, opens the **email outbox** (emails are captured, and their links work) and resets the data.
- **Real-time:** each tab keeps its own account but shares one database. Open a second tab as another student and book a slot; the first tab changes AVAILABLE → BOOKED instantly.

`npm run build:demo` writes a static copy to `web/dist-demo/` that can be served from any static host. The production build (`npm run build`) contains no demo code.

---

## Setup

### 1. Firebase project
1. Create a project at <https://console.firebase.google.com>. Upgrade it to the **Blaze** plan (Cloud Functions and scheduled functions require it).
2. **Authentication → Sign-in method → Google**: enable it. Under **Settings → Authorized domains**, add your hosting domain.
3. **Realtime Database**: create a database (e.g. `asia-southeast1`).
4. **Storage**: create the default bucket.
5. **Project settings → Your apps → Web app**: register a web app and copy its config.

### 2. Configure
```bash
npm install -g firebase-tools
firebase login
firebase use --add            # pick your project (updates .firebaserc)
```

Web config — copy `web/.env.example` to `web/.env.local` and fill in the values.

Functions config — create `functions/.env.<project-id>`:
```
MAIN_ADMIN_EMAILS=fc.coordinator@nift.ac.in      # comma-separated; become Main Admin on sign-in
APP_URL=https://<your-project>.web.app            # used in email links
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=fc.photolab@nift.ac.in
MAIL_FROM="FC Photography Lab <fc.photolab@nift.ac.in>"
```
Set the SMTP password as a secret. For a Google Workspace account, use an App Password:
```bash
firebase functions:secrets:set SMTP_PASS
```
The secret has to exist before deploying. If email isn't ready yet, set a placeholder value. Emails are then logged as `not-configured` and nothing else is affected.

**Easier option: email through Google Sheets (Apps Script).** You don't need an SMTP password. All emails are sent from the Google account that owns the sheet, and the sheet keeps one live row per booking. A row turns red when the faculty says "I DID NOT APPROVE THIS". Setup: [apps-script/README.md](apps-script/README.md). Then add `SHEETS_WEBHOOK_URL` and `SHEETS_WEBHOOK_SECRET` to `functions/.env.<project-id>`.

### 3. Deploy
```bash
cd functions && npm install && npm test && cd ..
cd web && npm install && npm run build && cd ..
firebase deploy
```
The functions region is `asia-south1` (Mumbai). To change it, edit `functions/src/core.js` and `VITE_FUNCTIONS_REGION` together.

### 4. First sign-in
1. Sign in with an email listed in `MAIN_ADMIN_EMAILS`. The first call seeds the default rules, questions, declaration and equipment into `/settings`.
2. Go to **Admins & Roles** and add Staff Admins and FC-CC Admins by NIFT email. Each role applies on that person's next sign-in.
3. Review **Rules & Questions**: hours, window, declaration text, questions and requirement items.
4. Add public holidays under **Holidays & Overrides**.

### Local development with emulators
The Realtime Database emulator needs **Java 11+**.
```bash
firebase emulators:start          # auth, functions, database, storage, hosting
# in web/.env.local:  VITE_USE_EMULATORS=true
cd web && npm run dev             # http://localhost:5173
```

### Changing the allowed email domain
The domain `nift.ac.in` appears in three places. Keep them in sync:
- `functions/shared/constants.js` → `ALLOWED_EMAIL_DOMAINS`
- `database.rules.json` → the `/.*@nift\\.ac\\.in$/` regex
- `web/.env.local` → `VITE_ALLOWED_DOMAIN`

---

## Hosting on Vercel
`vercel.json` builds the web app from `web/` into `web/dist-vercel`.

- **Default: demo.** Runs entirely in the browser with sample data; no Firebase is needed.
- **Live Firebase app:** in Vercel → Project → Settings → Environment Variables, add `FC_MODE=production` and every `VITE_FIREBASE_*` value from `web/.env.example`, then redeploy. Also add the Vercel domain under Firebase Authentication → **Authorized domains**. The Cloud Functions and rules are still deployed with `firebase deploy` (Vercel hosts only the web app).

## Roles
| Role | Can |
|---|---|
| **Main Admin** | Everything: admins and roles, rules, questions, declaration, equipment, academic calendar, all bookings |
| **Staff Admin** (FC Lab Assistant — mediator) | Calendar, book for students, open/block slots, holidays, student records; prints special-hours forms and hands them to students. **Cannot approve, reject or cancel bookings** |
| **FC-CC Admin** | **Every decision:** approves (digitally signed) or rejects every booking, cancels bookings, gives special final approval, decides faculty concerns |
| **FC Student** (by classification) | Own bookings, plus approve or reject FC approval requests assigned to them |

## Tests
```bash
cd functions && npm test
```
These cover slot classification, override priority, booking window, duration limits, special-hours detection, the booking ID format, NIFT ID keys, semester progression and graduation, and scheduler idempotency.
