// Generates database.rules.json — the security rules of the Realtime Database.
// On the free Spark plan the booking logic runs in the browser, so THESE RULES
// are what really protect the data. Run: node scripts/build-db-rules.mjs
import { writeFileSync } from 'node:fs';

const MAIN_EMAIL = 'fc.jodhpur@nift.ac.in';
const EMAIL = 'auth.token.email.toLowerCase()';

// ---- building blocks ----
const V = `(auth != null && auth.token.email_verified === true && ${EMAIL}.matches(/^[^@]+@nift\\.ac\\.in$/))`;
const ROLE = "root.child('roles/' + auth.uid + '/role').val()";
const ADMIN = `(${V} && (${ROLE} === 'main' || ${ROLE} === 'staff' || ${ROLE} === 'fccc'))`;
const STAFF = `(${V} && (${ROLE} === 'main' || ${ROLE} === 'staff'))`;
const MAIN = `(${V} && ${ROLE} === 'main')`;
const MY_EMAIL_KEY = `${EMAIL}.replace('.', ',')`;
const or = (...xs) => `(${xs.join(' || ')})`;
const and = (...xs) => `(${xs.join(' && ')})`;
const same = (field) => `newData.child('${field}').val() === data.child('${field}').val()`;
const isOneOf = (expr, values) => or(...values.map((v) => `${expr} === '${v}'`));

const HOLDING = ['SUBMITTED', 'PENDING_FC_APPROVAL', 'FC_APPROVED', 'PENDING_SPECIAL_APPROVAL', 'PENDING_FCCC_APPROVAL', 'PENDING_DEPT_CC', 'PENDING_DIRECTOR', 'FACULTY_CONCERN', 'APPROVED', 'COMPLETED'];
const ENDED = ['REJECTED', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN'];

// ---- bookings ----
const NEW_STATUS = "newData.child('status').val()";
const OLD_STATUS = "data.child('status').val()";
const SAME_CORE = and(same('id'), same('studentUid'), same('date'), same('startHour'), same('endHour'), same('startAt'), same('studentType'), same('isSpecial'));
// Only admins may record FC-CC approval or the special-form steps.
const SAME_DECISIONS = and(
  "newData.child('fcccApproval/at').val() === data.child('fcccApproval/at').val()",
  "newData.child('special/steps/fcAssistant/state').val() === data.child('special/steps/fcAssistant/state').val()",
  "newData.child('special/steps/final/state').val() === data.child('special/steps/final/state').val()",
  "newData.child('deptCcApproval/at').val() === data.child('deptCcApproval/at').val()",
  "newData.child('directorApproval/at').val() === data.child('directorApproval/at').val()",
);
const ME = "root.child('users/' + auth.uid)";
const R = (key) => `root.child('settings/bookingRules/${key}')`;
const IST_HOUR = '(((now + 19800000) % 86400000) / 3600000)';
// Booking starts after the end of (today + N days) in IST → the booking hours don't apply.
const FAR_AHEAD = `(${R('bookingHoursWithinDays')}.exists() && newData.child('startAt').val() >= now - ((now + 19800000) % 86400000) + (${R('bookingHoursWithinDays')}.val() + 1) * 86400000)`;
const BOOKING_CREATE = and(
  '!data.exists()',
  "newData.child('id').val() === $bookingId",
  "newData.child('studentUid').val() === auth.uid",
  `newData.child('email').val() === ${EMAIL}`,
  `newData.child('studentType').val() === ${ME}.child('studentType').val()`,
  `${ME}.child('status').val() === 'ACTIVE'`,
  `${ME}.child('bookingAccess').val() === true`,
  // cancelled recently → blocked for a few days
  `(!${ME}.child('bookingBlock/until').exists() || ${ME}.child('bookingBlock/until').val() < now)`,
  isOneOf(NEW_STATUS, ['PENDING_FC_APPROVAL', 'PENDING_FCCC_APPROVAL']),
  "!newData.child('deptCcApproval').exists()",
  "!newData.child('directorApproval').exists()",
  "!newData.child('fcccApproval').exists()",
  "!newData.child('special/steps').exists()",
  // other departments always need their FC student first
  `(newData.child('studentType').val() !== 'OTHER_DEPT_STUDENT' || (${NEW_STATUS} === 'PENDING_FC_APPROVAL' && newData.child('fcStudentUid').exists() && newData.child('fcStudentUid').val() !== auth.uid))`,
  // after 10 PM is always special
  "(newData.child('endHour').val() <= 22 || newData.child('isSpecial').val() === true)",
  // when students may book (IST): regular 9 AM–4 PM; special 9 AM–2 PM and ≥ 24 h ahead
  `(newData.child('isSpecial').val() === true || ${FAR_AHEAD} || !${R('regularBookingOpenHour')}.exists() || !${R('regularBookingCloseHour')}.exists() || (${IST_HOUR} >= ${R('regularBookingOpenHour')}.val() && ${IST_HOUR} < ${R('regularBookingCloseHour')}.val()))`,
  `(newData.child('isSpecial').val() !== true || ((${FAR_AHEAD} || !${R('specialBookingOpenHour')}.exists() || !${R('specialBookingCloseHour')}.exists() || (${IST_HOUR} >= ${R('specialBookingOpenHour')}.val() && ${IST_HOUR} < ${R('specialBookingCloseHour')}.val())) && (!${R('specialMinNoticeHours')}.exists() || newData.child('startAt').val() - now >= ${R('specialMinNoticeHours')}.val() * 3600000)))`,
  // sane times: in the future, within the booking window, 1–6 hours
  "newData.child('startAt').val() > now",
  "newData.child('startAt').val() < now + 8 * 86400000",
  "newData.child('endHour').val() - newData.child('startHour').val() >= 1",
  "newData.child('endHour').val() - newData.child('startHour').val() <= (newData.child('studentType').val() === 'OTHER_DEPT_STUDENT' ? 4 : 6)",
);
const OWNER_CANCEL = and(
  "data.child('studentUid').val() === auth.uid",
  isOneOf(OLD_STATUS, HOLDING.filter((s) => s !== 'COMPLETED')),
  `${NEW_STATUS} === 'CANCELLED_BY_STUDENT'`,
  "data.child('startAt').val() > now",
  SAME_CORE,
  SAME_DECISIONS,
);
const FC_STUDENT_ANSWER = and(
  "data.child('fcStudentUid').val() === auth.uid",
  or(`${OLD_STATUS} === 'PENDING_FC_APPROVAL'`, and(`${OLD_STATUS} === 'FACULTY_CONCERN'`, "data.child('facultyConcern/previousStatus').val() === 'PENDING_FC_APPROVAL'")),
  or(
    `${NEW_STATUS} === 'REJECTED'`,
    `${NEW_STATUS} === 'FACULTY_CONCERN'`,
    `${NEW_STATUS} === 'PENDING_DEPT_CC'`, // other departments: the Dept CC is next
  ),
  SAME_CORE,
  SAME_DECISIONS,
);
const FACULTY_CONCERN = and(
  `data.child('faculty/email').val() === ${EMAIL}`,
  "!data.child('facultyConcern').exists()",
  `newData.child('facultyConcern/facultyEmail').val() === ${EMAIL}`,
  or(`${NEW_STATUS} === ${OLD_STATUS}`, `${NEW_STATUS} === 'FACULTY_CONCERN'`),
  SAME_CORE,
  SAME_DECISIONS,
);

// ---- slots: one node per hour ----
const NEWROOT_SLOT = 'newData.parent().parent().parent()';
const SLOT_BOOKING = `${NEWROOT_SLOT}.child('bookings/' + data.child('bookingId').val())`;
const SLOT_WRITE = or(
  // claim an empty hour (for yourself; admins for a student)
  and('!data.exists()', 'newData.exists()', or("newData.child('uid').val() === auth.uid", ADMIN), "newData.child('status').val() === 'SUBMITTED'"),
  ADMIN,
  // people on the booking keep the hour in step with the booking
  and(
    'data.exists()',
    or(
      "data.child('uid').val() === auth.uid",
      `${SLOT_BOOKING}.child('fcStudentUid').val() === auth.uid`,
      `${SLOT_BOOKING}.child('faculty/email').val() === ${EMAIL}`,
    ),
    or(
      // release: only once the booking has ended (or was never written)
      and('!newData.exists()', or(`!${SLOT_BOOKING}.exists()`, isOneOf(`${SLOT_BOOKING}.child('status').val()`, ENDED))),
      // status copy
      and('newData.exists()', same('bookingId'), same('uid'), `newData.child('status').val() === ${SLOT_BOOKING}.child('status').val()`),
    ),
  ),
);

const rules = {
  rules: {
    '.read': false,
    '.write': false,

    roles: {
      '.read': MAIN,
      $uid: {
        '.read': `${V} && auth.uid === $uid`,
        '.write': or(
          MAIN,
          and(
            V, 'auth.uid === $uid',
            or(
              `(${EMAIL} === '${MAIN_EMAIL}' && newData.child('role').val() === 'main')`,
              `(newData.child('role').exists() && root.child('adminInvites/' + ${MY_EMAIL_KEY} + '/role').val() === newData.child('role').val())`,
            ),
          ),
        ),
        '.validate': "!newData.exists() || newData.child('role').val() === 'main' || newData.child('role').val() === 'staff' || newData.child('role').val() === 'fccc'",
      },
    },

    admins: {
      '.read': V,
      '.indexOn': ['email', 'role'],
      $uid: {
        '.write': or(MAIN, and(V, 'auth.uid === $uid', "newData.child('role').val() === newData.parent().parent().child('roles/' + $uid + '/role').val()")),
      },
    },

    adminInvites: {
      '.read': MAIN,
      $key: {
        '.read': `${V} && $key === ${MY_EMAIL_KEY}`,
        '.write': or(MAIN, and(V, '!newData.exists()', `$key === ${MY_EMAIL_KEY}`)),
      },
    },

    users: {
      '.read': ADMIN,
      '.indexOn': ['niftId', 'email', 'status', 'department', 'semester', 'idmRequest/state'],
      $uid: {
        '.read': `${V} && auth.uid === $uid`,
        '.write': or(
          ADMIN,
          and(
            V, 'auth.uid === $uid',
            or(
              // registration
              and(
                '!data.exists()',
                "newData.child('uid').val() === auth.uid",
                `newData.child('email').val() === ${EMAIL}`,
                "newData.child('status').val() === 'ACTIVE'",
                "newData.child('bookingAccess').val() === true",
                "((newData.child('department').val() === 'FC' && newData.child('studentType').val() === 'FC_STUDENT') || (newData.child('department').val() !== 'FC' && newData.child('studentType').val() === 'OTHER_DEPT_STUDENT'))",
              ),
              // own updates: phone, last login, starting a cancel block — nothing staff controls
              and(
                'data.exists()', 'newData.exists()',
                same('uid'), same('niftId'), same('email'), same('name'), same('status'), same('studentType'),
                same('department'), same('semester'), same('bookingAccess'),
                "(!data.child('bookingBlock/until').exists() || data.child('bookingBlock/until').val() < now || newData.child('bookingBlock/until').val() >= data.child('bookingBlock/until').val())",
              ),
            ),
          ),
        ),
      },
    },

    students: {
      '.read': V,
      '.indexOn': ['uid', 'name', 'department', 'status', 'studentType'],
      $key: {
        '.write': or(
          STAFF,
          and(
            V,
            or(
              // claim a free NIFT ID (only before registering)
              and('!data.exists()', "newData.child('uid').val() === auth.uid", "!newData.child('studentType').exists()", "!root.child('users/' + auth.uid + '/niftId').exists()"),
              // complete the claimed entry once, at registration
              and(
                "data.child('uid').val() === auth.uid", "!data.child('studentType').exists()", 'newData.exists()',
                "newData.child('uid').val() === auth.uid", same('niftId'),
                `newData.child('email').val() === ${EMAIL}`,
                "newData.child('status').val() === 'ACTIVE'",
                "((newData.child('department').val() === 'FC' && newData.child('studentType').val() === 'FC_STUDENT') || (newData.child('department').val() !== 'FC' && newData.child('studentType').val() === 'OTHER_DEPT_STUDENT'))",
              ),
              // undo a claim
              and("data.child('uid').val() === auth.uid", "!data.child('studentType').exists()", '!newData.exists()'),
            ),
          ),
        ),
      },
    },

    bookings: {
      '.read': or(ADMIN, and(V, "query.orderByChild === 'studentUid'", 'query.equalTo === auth.uid')),
      '.indexOn': ['studentUid', 'status', 'date', 'fcStudentUid', 'seniorUid', 'createdAt', 'startAt'],
      $bookingId: {
        '.read': and(V, or(
          "data.child('studentUid').val() === auth.uid",
          "data.child('fcStudentUid').val() === auth.uid",
          "data.child('seniorUid').val() === auth.uid",
          `data.child('faculty/email').val() === ${EMAIL}`,
        )),
        '.write': or(ADMIN, and(V, or(BOOKING_CREATE, OWNER_CANCEL, FC_STUDENT_ANSWER, FACULTY_CONCERN))),
      },
    },

    bookingSlots: {
      '.read': V,
      $date: {
        '.write': ADMIN, // admins may clear whole days (old-data cleanup)
        $hour: {
          '.write': SLOT_WRITE,
          '.validate': "newData.hasChildren(['bookingId', 'status', 'uid'])",
        },
      },
    },

    counters: {
      bookingIds: {
        $day: {
          '.read': V,
          '.write': V,
          '.validate': "newData.isNumber() && ((!data.exists() && newData.val() === 1) || (data.exists() && newData.val() === data.val() + 1))",
        },
      },
    },

    fcApprovals: {
      '.read': or(ADMIN, and(V, "query.orderByChild === 'fcStudentUid'", 'query.equalTo === auth.uid')),
      '.indexOn': ['fcStudentUid', 'requesterUid', 'state', 'bookingId', 'createdAt'],
      $id: {
        '.read': and(V, or("data.child('fcStudentUid').val() === auth.uid", "data.child('requesterUid').val() === auth.uid")),
        '.write': or(
          ADMIN,
          and(V, or(
            and('!data.exists()', "newData.child('requesterUid').val() === auth.uid", "newData.child('state').val() === 'PENDING'"),
            and(
              "data.child('fcStudentUid').val() === auth.uid", "data.child('state').val() !== 'CANCELLED'",
              isOneOf("newData.child('state').val()", ['PENDING', 'APPROVED', 'REJECTED']),
              same('bookingId'), same('fcStudentUid'), same('requesterUid'),
            ),
            and("data.child('requesterUid').val() === auth.uid", "newData.child('state').val() === 'CANCELLED'", same('bookingId'), same('fcStudentUid'), same('requesterUid')),
          )),
        ),
      },
    },

    facultyNotifications: {
      '.read': ADMIN,
      $bookingId: {
        '.read': `${V} && data.child('facultyEmail').val() === ${EMAIL}`,
        '.write': or(
          ADMIN,
          and(V, or(
            and('!data.exists()', "newData.parent().parent().child('bookings/' + $bookingId + '/studentUid').val() === auth.uid"),
            and(`data.child('facultyEmail').val() === ${EMAIL}`, "!data.child('response').exists()", same('facultyEmail'), same('tokenHash'), same('bookingId')),
          )),
        ),
      },
    },

    approvals: {
      '.read': ADMIN,
      '.indexOn': ['bookingId', 'at', 'kind'],
      $id: { '.write': or(ADMIN, and(V, '!data.exists()', "newData.child('byUid').val() === auth.uid")) },
    },

    auditLogs: {
      '.read': ADMIN,
      '.indexOn': ['at', 'bookingId', 'niftId', 'action', 'uid'],
      $id: { '.write': or(ADMIN, and(V, '!data.exists()', "(newData.child('uid').val() === auth.uid || newData.child('uid').val() === 'system')")) },
    },

    emailLogs: {
      '.read': STAFF,
      '.indexOn': ['createdAt', 'bookingId', 'status', 'type'],
      $id: {
        '.write': or(ADMIN, and(V, or(
          and('!data.exists()', isOneOf("newData.child('status').val()", ['queued', 'skipped'])),
          and('data.exists()', 'newData.exists()', same('createdAt'), same('subject'), same('recipient')),
        ))),
      },
    },

    settings: {
      '.read': V,
      '.write': or(MAIN, and(V, "!root.child('settings/initializedAt').exists()")),
      holidays: { '.write': STAFF },
      availabilityOverrides: { '.write': STAFF },
      academicCalendar: { lastRuns: { '.write': ADMIN } },
    },

    equipment: {
      '.read': V,
      '.write': or(MAIN, and(V, '!data.exists()')),
    },

    files: {
      $bookingId: {
        '.read': or(ADMIN, and(V, or(
          "root.child('bookings/' + $bookingId + '/studentUid').val() === auth.uid",
          "root.child('bookings/' + $bookingId + '/fcStudentUid').val() === auth.uid",
          "root.child('bookings/' + $bookingId + '/seniorUid').val() === auth.uid",
        ))),
        $name: { '.write': or(ADMIN, and(V, '!data.exists()', "newData.child('uid').val() === auth.uid")) },
      },
    },

    staffSignatures: {
      $uid: { '.read': or(ADMIN, `${V} && auth.uid === $uid`), '.write': `${ADMIN} && auth.uid === $uid` },
    },

    maintenance: { '.read': ADMIN, '.write': ADMIN },
  },
};

writeFileSync(new URL('../database.rules.json', import.meta.url), `${JSON.stringify(rules, null, 2)}\n`);
console.log('database.rules.json written');
