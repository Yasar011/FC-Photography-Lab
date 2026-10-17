import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { call } from '../firebase.js';
import { STATUS, STUDENT_TYPES, specialStepsFor, ADMIN_GUARD_NOTE } from '@shared/constants.js';
import { formatDate, formatHour, formatRange, BOOKABLE_STATES, SLOT_LABELS, SLOT } from '@shared/calendar.js';
import { sortedEntries, maxHoursFor, DEFAULT_DECLARATION, DEFAULT_QUESTIONS, DEFAULT_EQUIPMENT } from '@shared/defaults.js';

import { DigitalStamp } from './SignApprove.jsx';
import PersonLookup from './PersonLookup.jsx';
import Icon from './Icon.jsx';
import { Alert, Field, StatusBadge, useToast } from './ui.jsx';
import { Drawer } from './cal/Overlays.jsx';

const SLOT_TAKEN = 'This slot has just been booked by another student. Please select another available time.';

/** Check a range against the live classified slots shown in the calendar. */
export function rangeProblem(daySlotList, start, end) {
  for (let h = start; h < end; h++) {
    const s = daySlotList.find((x) => x.hour === h);
    if (!s || !BOOKABLE_STATES.includes(s.state)) {
      const taken = s && [SLOT.BOOKED, SLOT.PENDING, SLOT.MINE, SLOT.APPROVED].includes(s.state);
      return taken ? SLOT_TAKEN : `${formatRange(h, h + 1)} is not available (${s ? (s.state === SLOT.CLASS ? 'CLS class' : SLOT_LABELS[s.state]) : 'closed'}).`;
    }
  }
  return '';
}

export default function BookingForm({ student, staffMode, selection, onSelection, dates, slotsByDate, onClose, onBooked, pastFaculty = [] }) {
  const { rules, settings, equipment: equipmentConfig } = useAuth();
  const toast = useToast();
  const bodyRef = useRef(null);
  const maxH = maxHoursFor(rules, student.studentType); // FC students 4 h, others 3 h

  const { date, start, end } = selection;
  const daySlots = slotsByDate[date] || [];
  const slotError = rangeProblem(daySlots, start, end);
  const range = daySlots.filter((s) => s.hour >= start && s.hour < end);
  const requiresSpecial = range.some((s) => s.requiresSpecial);
  const usesOverride = range.some((s) => s.override);

  // Other-department students aren't offered items like the FC camera.
  const equipment = sortedEntries(Object.keys(equipmentConfig || {}).length ? equipmentConfig : DEFAULT_EQUIPMENT)
    .filter((e) => e.enabled && !(student.studentType === STUDENT_TYPES.OTHER && e.otherDeptBringOwn));
  const questions = sortedEntries(settings.questions || DEFAULT_QUESTIONS).filter((q) => q.enabled);
  const declaration = settings.declaration || DEFAULT_DECLARATION;
  const confirmationList = sortedEntries(declaration.confirmations).filter((c) => c.enabled);

  const isOther = student.studentType === STUDENT_TYPES.OTHER;
  const firstYear = Number(student.semester) <= rules.firstYearMaxSemester;
  const needsFc = (isOther && rules.otherDeptRequiresFcStudent) || (student.studentType === STUDENT_TYPES.FC_IDM && rules.fcIdmRequiresFcApproval);

  const [form, setForm] = useState(() => ({
    purpose: '',
    equipment: equipment.some((e) => e.id === 'photoLab') ? ['photoLab'] : [],
    equipmentReasons: {},
    // Prefill sensible defaults (e.g. number of people = 1).
    answers: Object.fromEntries(questions.filter((q) => q.defaultValue !== undefined && q.defaultValue !== null).map((q) => [q.id, q.defaultValue])),
    // Last faculty used is filled in for you.
    facultyName: pastFaculty[0]?.name || '',
    facultyEmail: pastFaculty[0]?.email || '',
    remarks: '',
  }));
  const [showFaculty, setShowFaculty] = useState(rules.facultyEmailRequired !== false);
  const [fcStudent, setFcStudent] = useState(null);
  const [senior, setSenior] = useState(null);
  const [confirmations, setConfirmations] = useState({});
  const [signed, setSigned] = useState(false); // digital signature = explicit consent
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Time pickers — only offer starts that are bookable, ends up to the max duration.
  const startOptions = daySlots.filter((s) => BOOKABLE_STATES.includes(s.state) || s.hour === start).map((s) => s.hour);
  const endOptions = [];
  for (let e = start + 1; e <= Math.min(start + maxH, rules.gridEndHour); e++) endOptions.push(e);

  useEffect(() => {
    if (result) return;
    if (slotError === SLOT_TAKEN) setError(SLOT_TAKEN);
  }, [slotError, result]);

  function validate() {
    if (slotError) return slotError;
    if (form.purpose.trim().length < 3) return 'Please describe the purpose of the booking.';
    if (!form.equipment.length) return 'Please select at least one requirement.';
    for (const id of form.equipment) {
      const item = equipmentConfig?.[id];
      if (item?.requiresReason && (form.equipmentReasons[id] || '').trim().length < 3) return item.reasonLabel || `Please explain why you need ${item.name}.`;
    }
    for (const q of questions) {
      const v = form.answers[q.id];
      if (q.required && (v === undefined || v === '' || v === false)) return `Please answer: ${q.label}`;
    }
    if (firstYear && !senior) return 'Please add the senior student who will accompany you.';
    if (needsFc && !fcStudent) return 'Please select the FC student involved in this booking.';
    if (rules.facultyEmailRequired && !form.facultyEmail.trim()) return 'Faculty email is required.';
    if (form.facultyEmail.trim() && !form.facultyName.trim()) return 'Please enter the subject/faculty name.';
    if (form.facultyEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.facultyEmail.trim())) return 'Please enter a valid faculty email.';
    for (const c of confirmationList) if (c.required && !confirmations[c.id]) return `Please tick: ${c.label}`;
    if (!signed) return 'Please tick “I sign this booking digitally”.';
    return '';
  }

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) {
      bodyRef.current?.closest('.drawer-body')?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    try {
      const r = await call('createBooking', {
        date,
        startHour: start,
        endHour: end,
        purpose: form.purpose.trim(),
        equipment: form.equipment,
        equipmentReasons: form.equipmentReasons,
        answers: form.answers,
        facultyName: form.facultyName.trim(),
        facultyEmail: form.facultyEmail.trim(),
        fcStudentNiftId: needsFc ? fcStudent?.niftId : undefined,
        seniorNiftId: firstYear ? senior?.niftId : undefined,
        confirmations,
        signDigitally: signed,
        ...(staffMode ? { onBehalfOfNiftId: student.niftId, remarks: form.remarks.trim() } : {}),
      });
      setResult(r);
      onBooked?.(r);
      toast(`Booking ${r.bookingId} submitted`, 'ok');
    } catch (e) {
      setError(e.message || SLOT_TAKEN);
      bodyRef.current?.closest('.drawer-body')?.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <Drawer title="Booking submitted" onClose={onClose} footer={<><span /><button className="btn btn-primary" onClick={onClose}>Done</button></>}>
        <Done result={result} fcStudent={fcStudent} staffMode={staffMode} date={date} start={start} end={end} studentType={student.studentType} />
      </Drawer>
    );
  }

  // Nothing is confirmed without the FC-CC.
  const submitLabel = needsFc ? 'Submit for FC student approval' : requiresSpecial ? 'Submit for special approval' : 'Send to FC-CC for approval';
  const hasPeople = firstYear || needsFc;
  let n = 0;

  return (
    <Drawer
      title={staffMode ? `Book for ${student.name}` : 'Book the Photography Lab'}
      onClose={onClose}
      footer={
        <>
          <span className="small muted">{end - start} h · {formatRange(start, end)}</span>
          <button className="btn btn-primary btn-lg" onClick={submit} disabled={submitting || slotError === SLOT_TAKEN}>
            {submitting ? 'Submitting…' : submitLabel}
          </button>
        </>
      }
    >
      <div ref={bodyRef} className="stack">
        <Alert kind="error">{error}</Alert>
        <div className="slot-sum">
          <Icon name="clock" />
          <div className="grow">
            <div className="big">{formatDate(date, { weekday: true })}</div>
            <div className="small muted">{formatRange(start, end)} · {end - start} hour{end - start > 1 ? 's' : ''}{usesOverride ? ' · opened by FC Staff' : ''}</div>
          </div>
          {requiresSpecial && <span className="badge tone-orange">Special approval</span>}
        </div>
        <div className="time-row">
          <Field label="Date">
            <select className="select" value={date} onChange={(e) => onSelection({ date: e.target.value, start, end })}>
              {dates.map((d) => <option key={d} value={d}>{formatDate(d, { weekday: true })}</option>)}
            </select>
          </Field>
          <Field label="From">
            <select className="select" value={start} onChange={(e) => { const s = Number(e.target.value); onSelection({ date, start: s, end: Math.min(s + Math.max(1, end - start), s + maxH) }); }}>
              {startOptions.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
            </select>
          </Field>
          <Field label="To">
            <select className="select" value={end} onChange={(e) => onSelection({ date, start, end: Number(e.target.value) })}>
              {endOptions.map((h) => <option key={h} value={h}>{formatHour(h)} ({h - start} h)</option>)}
            </select>
          </Field>
        </div>
        <div className="dur-chips" role="group" aria-label="Duration">
          {Array.from({ length: maxH }, (_, i) => i + 1).map((h) => {
            const ok = !rangeProblem(daySlots, start, start + h) || h <= end - start;
            return (
              <button key={h} type="button" className={end - start === h ? 'on' : ''} disabled={!ok || start + h > rules.gridEndHour} onClick={() => onSelection({ date, start, end: start + h })}>
                {h} h
              </button>
            );
          })}
          <span className="small muted" style={{ alignSelf: 'center' }}>max {maxH} h</span>
        </div>
        {slotError && slotError !== error && <Alert kind="error">{slotError}</Alert>}
        {requiresSpecial && !slotError && (
          <Alert kind="warn">
            <span><b>{rules.specialHoursMessage}</b> After you submit: FC Lab Assistant prints the form → {specialStepsFor(student.studentType).filter((x) => x.paper).map((x) => x.label).join(' → ')} → FC-CC approves & signs → give the form to the Admin Guard.</span>
          </Alert>
        )}
        {firstYear && <Alert kind="warn">{rules.firstYearMessage}</Alert>}
      </div>

      <section>
        <div className="section-title"><span className="n">{++n}</span> What are you shooting?</div>
        <div className="stack">
          <Field label="Purpose" required>
            <textarea className="textarea" value={form.purpose} onChange={(e) => set('purpose', e.target.value)} maxLength={500} placeholder="e.g. Portfolio shoot for Fashion Photography" rows={2} />
          </Field>
          <Field label="What do you need?" required>
            <div className="chips">
              {equipment.map((e) => {
                const on = form.equipment.includes(e.id);
                return (
                  <label key={e.id} className={`chip ${on ? 'on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => set('equipment', on ? form.equipment.filter((x) => x !== e.id) : [...form.equipment, e.id])} />
                    {e.name}
                  </label>
                );
              })}
            </div>
          </Field>
          {form.equipment.map((id) => ({ id, ...equipmentConfig?.[id] })).filter((e) => e.requiresReason).map((e) => (
            <Field key={e.id} label={e.reasonLabel || `Why do you need ${e.name}?`} required>
              <textarea className="textarea" rows={2} value={form.equipmentReasons[e.id] || ''} onChange={(ev) => set('equipmentReasons', { ...form.equipmentReasons, [e.id]: ev.target.value })} maxLength={1000} />
            </Field>
          ))}
          {isOther && rules.otherDeptNoticeEnabled && (
            <p className="red-note">{rules.otherDeptNotice}</p>
          )}
          {questions.map((q) => (
            <QuestionInput key={q.id} q={q} value={form.answers[q.id]} onChange={(v) => set('answers', { ...form.answers, [q.id]: v })} />
          ))}
        </div>
      </section>

      {hasPeople && (
        <section>
          <div className="section-title"><span className="n">{++n}</span> Students involved</div>
          <div className="stack-lg">
            {firstYear && (
              <PersonLookup label="Senior student" purpose="senior" required value={senior} onChange={setSenior} help={`Semester ${rules.seniorMinSemester}+ · must be registered`} />
            )}
            {needsFc && (
              <div className="stack">
                <p className="small muted">Type the FC student's name — they approve this booking from their own account.</p>
                <PersonLookup label="FC student" purpose="fc" required value={fcStudent} onChange={setFcStudent} />
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <div className="section-title"><span className="n">{++n}</span> Subject / faculty {rules.facultyEmailRequired ? '' : <span className="tiny" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(optional)</span>}</div>
        {showFaculty ? (
          <div className="stack">
            {pastFaculty.length > 0 && (
              <div className="chips">
                {pastFaculty.map((f) => (
                  <button
                    key={f.email}
                    type="button"
                    className={`chip ${form.facultyEmail === f.email ? 'on' : ''}`}
                    onClick={() => setForm((x) => ({ ...x, facultyName: f.name, facultyEmail: f.email }))}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-2">
              <Field label="Faculty name" required={rules.facultyEmailRequired}>
                <input className="input" value={form.facultyName} onChange={(e) => set('facultyName', e.target.value)} maxLength={120} />
              </Field>
              <Field label="Faculty email" required={rules.facultyEmailRequired}>
                <input className="input" type="email" value={form.facultyEmail} onChange={(e) => set('facultyEmail', e.target.value)} maxLength={160} placeholder={`name@${(rules.facultyEmailDomains || ['nift.ac.in'])[0]}`} />
              </Field>
            </div>
            <p className="tiny muted">Required. The faculty gets an informational email about this booking.</p>
          </div>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setShowFaculty(true)}><Icon name="plus" /> Add faculty</button>
        )}
        {staffMode && (
          <div style={{ marginTop: 14 }}>
            <Field label="Staff remarks">
              <textarea className="textarea" rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} maxLength={1000} />
            </Field>
          </div>
        )}
      </section>

      <section>
        <div className="section-title"><span className="n">{++n}</span> {declaration.title || 'Declaration'} & signature</div>
        <div className="stack">
          <div className="declaration">{declaration.text}</div>
          {confirmationList.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={Boolean(confirmations[c.id])} onChange={(e) => setConfirmations({ ...confirmations, [c.id]: e.target.checked })} />
              <span>{c.label}{c.required && <span style={{ color: 'var(--accent)' }}> *</span>}</span>
            </label>
          ))}
          {settings.instructions?.text && (
            <details>
              <summary className="small" style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--primary)' }}>Read the lab rules</summary>
              <div className="declaration" style={{ marginTop: 8 }}>{settings.instructions.text}</div>
            </details>
          )}
          <div className="label" style={{ marginTop: 6 }}>Digital signature{staffMode ? ' (the student confirms at the counter)' : ''}</div>
          <label className="check sign-check">
            <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
            <b>I, {student.name} ({student.niftId}), sign this booking digitally.</b>
          </label>
          {signed && <DigitalStamp sig={{ name: student.name, id: student.niftId, role: 'Student' }} preview />}
        </div>
      </section>
    </Drawer>
  );
}

function QuestionInput({ q, value, onChange }) {
  if (q.type === 'checkbox') {
    return (
      <label className="check">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{q.label}{q.required && <span style={{ color: 'var(--accent)' }}> *</span>}</span>
      </label>
    );
  }
  let input;
  if (q.type === 'textarea') input = <textarea className="textarea" rows={2} value={value ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={2000} />;
  else if (q.type === 'select') {
    const options = String(q.options || '').split(',').map((o) => o.trim()).filter(Boolean);
    input = (
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else {
    input = <input className="input" type={q.type === 'number' ? 'number' : 'text'} min={q.type === 'number' ? 0 : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={2000} />;
  }
  return <Field label={q.label} required={q.required} help={q.helpText}>{input}</Field>;
}

function Done({ result, fcStudent, staffMode, date, start, end, studentType }) {
  const special = result.status === STATUS.PENDING_SPECIAL_APPROVAL;
  const ok = result.status === STATUS.APPROVED;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6, alignItems: 'flex-start' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', background: ok ? 'var(--green-bg)' : 'var(--orange-bg)', color: ok ? 'var(--green)' : 'var(--orange)' }}>
          <Icon name={ok ? 'check' : 'clock'} size={28} />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>Booking ID</div>
        <div className="booking-id" style={{ fontSize: 26 }}>{result.bookingId}</div>
        <div className="small">{formatDate(date, { weekday: true })} · {formatRange(start, end)}</div>
        <StatusBadge status={result.status} />
      </div>
      {ok && <Alert kind="ok"><span>You're booked! <b>No printing needed.</b> A confirmation email has been sent.</span></Alert>}
      {result.status === STATUS.PENDING_FCCC_APPROVAL && (
        <Alert kind="info"><span>Sent to the <b>FC-CC</b> for approval. Your booking is confirmed only after the FC-CC approves — you'll get an email. No printing needed.</span></Alert>
      )}
      {result.status === STATUS.PENDING_FC_APPROVAL && (
        <Alert kind="warn">Waiting for {fcStudent?.name || 'the FC student'} to approve from their own account, then the FC-CC. They've been notified by email.</Alert>
      )}
      {special && (
        <div className="card card-pad">
          <h3 style={{ marginBottom: 12 }}>What happens next</h3>
          <ol className="track">
            {specialStepsFor(studentType).map((s, i) => (
              <li key={s.key} className={i === 0 ? 'current' : ''}>
                <span className="mark">{i + 1}</span>
                <div>
                  <div className="t-title">{s.todo}</div>
                  <div className="t-meta">{s.paper ? `${s.label} · signs on the paper form` : s.label}</div>
                </div>
              </li>
            ))}
            <li>
              <span className="mark">★</span>
              <div><div className="t-title"><b>{ADMIN_GUARD_NOTE}</b></div></div>
            </li>
          </ol>
          <p className="small muted" style={{ marginTop: 12 }}>Quote Booking ID <b className="mono">{result.bookingId}</b> at the FC office.</p>
        </div>
      )}
      <div className="row">
        <Link className="btn btn-tonal" to={`/bookings/${result.bookingId}`}>Open booking</Link>
        {special && staffMode && <Link className="btn" to={`/print/${result.bookingId}`}><Icon name="print" /> Print form</Link>}
      </div>
    </div>
  );
}

export { SLOT_TAKEN };
