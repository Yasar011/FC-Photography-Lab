import { useEffect, useState } from 'react';

import { useAuth } from '../../lib/auth.jsx';
import { call } from '../../firebase.js';
import { PageHead, Field, Alert, useToast, ConfirmModal } from '../../components/ui.jsx';
import {
  DEFAULT_QUESTIONS,
  DEFAULT_DECLARATION,
  DEFAULT_EQUIPMENT,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_ACADEMIC_CALENDAR,
  sortedEntries,
} from '@shared/defaults.js';
import { STUDENT_TYPES, STUDENT_TYPE_LABELS } from '@shared/constants.js';
import { DAY_NAMES, formatDateTime } from '@shared/calendar.js';
import { PROGRESSION_EVENTS, PROGRESSION_LABELS } from '@shared/academic.js';

const TABS = [
  ['rules', 'Booking rules'],
  ['questions', 'Questions'],
  ['declaration', 'Declaration'],
  ['equipment', 'Requirements'],
  ['instructions', 'Instructions'],
  ['academic', 'Academic calendar'],
];

export default function SettingsPage() {
  const [tab, setTab] = useState('rules');
  return (
    <>
      <PageHead eyebrow="Main Admin" title="Rules & questions" sub="Changes apply immediately for everyone. Every save is recorded in the audit log." />
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'rules' && <RulesEditor />}
      {tab === 'questions' && <QuestionsEditor />}
      {tab === 'declaration' && <DeclarationEditor />}
      {tab === 'equipment' && <EquipmentEditor />}
      {tab === 'instructions' && <InstructionsEditor />}
      {tab === 'academic' && <AcademicEditor />}
    </>
  );
}

function useSave(section) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (value) => {
    setBusy(true);
    setError('');
    try {
      await call('saveSettings', { section, value });
      toast('Settings saved', 'ok');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}

function SaveBar({ busy, error, onSave, onReset }) {
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <Alert kind="error">{error}</Alert>
      <div className="row">
        <button className="btn btn-primary" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        {onReset && <button className="btn btn-ghost" onClick={onReset} disabled={busy}>Discard</button>}
      </div>
    </div>
  );
}

const hourOptions = (from = 0, to = 24) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const hourLabel = (h) => (h === 24 ? '12:00 AM (midnight)' : `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`);

// ---- Booking rules ---------------------------------------------------------
function RulesEditor() {
  const { rules } = useAuth();
  const [r, setR] = useState(rules);
  useEffect(() => setR(rules), [rules]);
  const { busy, error, save } = useSave('bookingRules');
  const set = (k, v) => setR((x) => ({ ...x, [k]: v }));
  const num = (k) => (e) => set(k, Number(e.target.value));
  const bool = (k) => (e) => set(k, e.target.checked);
  const hourSel = (k, from, to) => (
    <select className="select" value={r[k]} onChange={num(k)}>
      {hourOptions(from, to).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
    </select>
  );
  const days = (k) => (
    <div className="chips">
      {DAY_NAMES.map((d, i) => {
        const on = (r[k] || []).includes(i);
        return (
          <label key={d} className={`chip ${on ? 'on' : ''}`}>
            <input type="checkbox" checked={on} onChange={() => set(k, on ? r[k].filter((x) => x !== i) : [...(r[k] || []), i])} />
            {d}
          </label>
        );
      })}
    </div>
  );

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head"><h2>Calendar hours</h2></div>
        <div className="card-body grid grid-3">
          <Field label="Calendar starts">{hourSel('gridStartHour', 0, 23)}</Field>
          <Field label="Calendar ends">{hourSel('gridEndHour', 1, 24)}</Field>
          <Field label="Class slot label"><input className="input" value={r.classLabel} onChange={(e) => set('classLabel', e.target.value)} /></Field>
          <Field label="CLS class starts">{hourSel('classStartHour', 0, 23)}</Field>
          <Field label="CLS class ends">{hourSel('classEndHour', 1, 24)}</Field>
          <Field label="Class days">{days('classDays')}</Field>
          <Field label="Regular booking starts">{hourSel('regularStartHour', 0, 23)}</Field>
          <Field label="Regular booking ends" help="Later hours need special approval">{hourSel('regularEndHour', 1, 24)}</Field>
          <Field label="Opened holidays start at">{hourSel('holidayOpenStartHour', 0, 23)}</Field>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Special approval</h2></div>
        <div className="card-body stack">
          <label className="check"><input type="checkbox" checked={r.afterHoursEnabled} onChange={bool('afterHoursEnabled')} /> Allow after-hours bookings (with special approval)</label>
          <label className="check"><input type="checkbox" checked={r.weekendBookingEnabled} onChange={bool('weekendBookingEnabled')} /> Allow weekend bookings (with special approval)</label>
          <div className="grid grid-2">
            <Field label="Weekend days">{days('weekendDays')}</Field>
            <Field label="Weekend bookings start">{hourSel('weekendStartHour', 0, 23)}</Field>
          </div>
          <Field label="Message shown for special bookings"><textarea className="textarea" value={r.specialHoursMessage} onChange={(e) => set('specialHoursMessage', e.target.value)} /></Field>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Limits</h2></div>
        <div className="card-body grid grid-4">
          <Field label="Student window (days)" help="Max 7"><input className="input" type="number" min={1} max={7} value={r.bookingWindowDays} onChange={num('bookingWindowDays')} /></Field>
          <Field label="Staff window (days)"><input className="input" type="number" min={1} max={120} value={r.staffBookingWindowDays} onChange={num('staffBookingWindowDays')} /></Field>
          <Field label="Max hours — FC students" help="FC & FC-IDM (default 4)"><input className="input" type="number" min={1} max={6} value={r.fcMaxDurationHours} onChange={num('fcMaxDurationHours')} /></Field>
          <Field label="Max hours — other students" help="Other departments (default 3)"><input className="input" type="number" min={1} max={4} value={r.maxDurationHours} onChange={num('maxDurationHours')} /></Field>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <label className="check"><input type="checkbox" checked={r.studentCanCancel} onChange={bool('studentCanCancel')} /> Students may cancel their own bookings before the start time</label>
          <div style={{ marginTop: 12, maxWidth: 360 }}>
            <Field label="Days blocked after a student cancels" help="The student can't book again for this many days (0 = no block).">
              <input className="input" type="number" min={0} max={30} value={r.cancelCooldownDays ?? 4} onChange={num('cancelCooldownDays')} />
            </Field>
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <Field label="Email when the FC-CC approves" help="Comma-separated. Special bookings include everyone's name, department, hostel and room.">
              <input
                className="input"
                value={Array.isArray(r.approvalNotifyEmails) ? r.approvalNotifyEmails.join(', ') : r.approvalNotifyEmails ?? ''}
                onChange={(e) => set('approvalNotifyEmails', e.target.value)}
                placeholder="admin.jodhpur@nift.ac.in"
              />
            </Field>
            <Field label="Maximum people on a special booking">
              <input className="input" type="number" min={1} max={100} value={r.maxParticipants ?? 30} onChange={num('maxParticipants')} />
            </Field>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Student rules</h2></div>
        <div className="card-body stack">
          <div className="grid grid-2">
            <Field label="First-year rule applies up to semester"><input className="input" type="number" min={0} max={2} value={r.firstYearMaxSemester} onChange={num('firstYearMaxSemester')} /></Field>
            <Field label="Senior student minimum semester"><input className="input" type="number" min={2} max={8} value={r.seniorMinSemester} onChange={num('seniorMinSemester')} /></Field>
          </div>
          <Field label="First-year message"><textarea className="textarea" value={r.firstYearMessage} onChange={(e) => set('firstYearMessage', e.target.value)} /></Field>
          <label className="check"><input type="checkbox" checked={r.otherDeptRequiresFcStudent} onChange={bool('otherDeptRequiresFcStudent')} /> Other Department students require FC student approval</label>
          <label className="check"><input type="checkbox" checked={r.fcIdmRequiresFcApproval} onChange={bool('fcIdmRequiresFcApproval')} /> FC-IDM students require FC student approval</label>
          <Field label="Who can give FC student approval">
            <div className="chips">
              {[STUDENT_TYPES.FC, STUDENT_TYPES.FC_IDM].map((t) => {
                const on = (r.fcApproverTypes || []).includes(t);
                return (
                  <label key={t} className={`chip ${on ? 'on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => set('fcApproverTypes', on ? r.fcApproverTypes.filter((x) => x !== t) : [...(r.fcApproverTypes || []), t])} />
                    {STUDENT_TYPE_LABELS[t]}
                  </label>
                );
              })}
            </div>
          </Field>
          <label className="check"><input type="checkbox" checked={r.otherDeptNoticeEnabled} onChange={bool('otherDeptNoticeEnabled')} /> Show equipment notice to Other Department students</label>
          <Field label="Other Department equipment notice" help="Students must acknowledge it when selecting items marked “bring own” in Requirements.">
            <textarea className="textarea" value={r.otherDeptNotice} onChange={(e) => set('otherDeptNotice', e.target.value)} />
          </Field>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Faculty</h2></div>
        <div className="card-body stack">
          <label className="check"><input type="checkbox" checked={r.facultyEmailRequired} onChange={bool('facultyEmailRequired')} /> Faculty name & email are required on every booking</label>
          <Field label="Allowed faculty email domains" help="Comma-separated">
            <input className="input" value={(r.facultyEmailDomains || []).join(', ')} onChange={(e) => set('facultyEmailDomains', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
          </Field>
        </div>
      </section>
      <SaveBar busy={busy} error={error} onSave={() => save(r)} onReset={() => setR(rules)} />
    </div>
  );
}

// ---- Generic list editor ---------------------------------------------------
function ListEditor({ items, setItems, renderItem, newItem, addLabel, idPrefix }) {
  const list = sortedEntries(items);
  const move = (id, dir) => {
    const idx = list.findIndex((x) => x.id === id);
    const swap = list[idx + dir];
    if (!swap) return;
    setItems({ ...items, [id]: { ...items[id], order: swap.order ?? idx + dir }, [swap.id]: { ...items[swap.id], order: items[id].order ?? idx } });
  };
  const update = (id, patch) => setItems({ ...items, [id]: { ...items[id], ...patch } });
  const remove = (id) => {
    const next = { ...items };
    delete next[id];
    setItems(next);
  };
  const add = () => {
    const id = `${idPrefix}_${Date.now().toString(36)}`;
    const maxOrder = Math.max(0, ...list.map((x) => Number(x.order) || 0));
    setItems({ ...items, [id]: { ...newItem, order: maxOrder + 1 } });
  };
  return (
    <div className="stack">
      {list.map((item, i) => (
        <div key={item.id} className="card card-pad" style={{ opacity: item.enabled === false ? 0.6 : 1 }}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className="tiny muted mono">{item.id}</span>
            <div className="row">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(item.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(item.id, 1)} disabled={i === list.length - 1} aria-label="Move down">↓</button>
              <label className="check small"><input type="checkbox" checked={item.enabled !== false} onChange={(e) => update(item.id, { enabled: e.target.checked })} /> Enabled</label>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(item.id)}>Delete</button>
            </div>
          </div>
          {renderItem(item, (patch) => update(item.id, patch))}
        </div>
      ))}
      <button type="button" className="btn" onClick={add}>+ {addLabel}</button>
      <p className="tiny muted">Tip: disabling keeps an item for reference; existing bookings keep a copy of the questions and declaration they were submitted with.</p>
    </div>
  );
}

function QuestionsEditor() {
  const { settings } = useAuth();
  const initial = settings.questions || DEFAULT_QUESTIONS;
  const [items, setItems] = useState(initial);
  const { busy, error, save } = useSave('questions');
  return (
    <>
      <ListEditor
        items={items}
        setItems={setItems}
        idPrefix="q"
        addLabel="Add question"
        newItem={{ label: 'New question', type: 'text', required: false, enabled: true, helpText: '', options: '' }}
        renderItem={(q, update) => (
          <div className="grid grid-2">
            <Field label="Question"><input className="input" value={q.label} onChange={(e) => update({ label: e.target.value })} /></Field>
            <Field label="Answer type">
              <select className="select" value={q.type} onChange={(e) => update({ type: e.target.value })}>
                <option value="text">Short text</option>
                <option value="textarea">Paragraph</option>
                <option value="number">Number</option>
                <option value="select">Dropdown</option>
                <option value="checkbox">Checkbox (Yes)</option>
              </select>
            </Field>
            <Field label="Help text"><input className="input" value={q.helpText || ''} onChange={(e) => update({ helpText: e.target.value })} /></Field>
            {q.type === 'select' ? (
              <Field label="Options" help="Comma-separated"><input className="input" value={q.options || ''} onChange={(e) => update({ options: e.target.value })} /></Field>
            ) : <div />}
            <label className="check"><input type="checkbox" checked={q.required === true} onChange={(e) => update({ required: e.target.checked })} /> Required</label>
          </div>
        )}
      />
      <SaveBar busy={busy} error={error} onSave={() => save(items)} onReset={() => setItems(initial)} />
    </>
  );
}

function DeclarationEditor() {
  const { settings } = useAuth();
  const initial = settings.declaration || DEFAULT_DECLARATION;
  const [d, setD] = useState(initial);
  const { busy, error, save } = useSave('declaration');
  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head"><h2>Declaration / undertaking text</h2></div>
        <div className="card-body stack">
          <Field label="Title"><input className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></Field>
          <Field label="Text shown before the signature"><textarea className="textarea" style={{ minHeight: 180 }} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} /></Field>
        </div>
      </section>
      <section>
        <h2 style={{ marginBottom: 10 }}>Checkbox confirmations</h2>
        <ListEditor
          items={d.confirmations || {}}
          setItems={(c) => setD({ ...d, confirmations: c })}
          idPrefix="c"
          addLabel="Add confirmation"
          newItem={{ label: 'I confirm…', required: true, enabled: true }}
          renderItem={(c, update) => (
            <div className="stack">
              <Field label="Confirmation text"><input className="input" value={c.label} onChange={(e) => update({ label: e.target.value })} /></Field>
              <label className="check"><input type="checkbox" checked={c.required === true} onChange={(e) => update({ required: e.target.checked })} /> Required</label>
            </div>
          )}
        />
      </section>
      <SaveBar busy={busy} error={error} onSave={() => save(d)} onReset={() => setD(initial)} />
    </div>
  );
}

function EquipmentEditor() {
  const { equipment } = useAuth();
  const initial = Object.keys(equipment || {}).length ? equipment : DEFAULT_EQUIPMENT;
  const [items, setItems] = useState(initial);
  const { busy, error, save } = useSave('equipment');
  return (
    <>
      <ListEditor
        items={items}
        setItems={setItems}
        idPrefix="eq"
        addLabel="Add requirement"
        newItem={{ name: 'New item', enabled: true, requiresReason: false, reasonLabel: '', otherDeptBringOwn: false }}
        renderItem={(e, update) => (
          <div className="grid grid-2">
            <Field label="Name"><input className="input" value={e.name} onChange={(ev) => update({ name: ev.target.value })} /></Field>
            <Field label="Reason question (if required)"><input className="input" value={e.reasonLabel || ''} onChange={(ev) => update({ reasonLabel: ev.target.value })} placeholder="e.g. Why do you need the CLS Class Room?" /></Field>
            <label className="check"><input type="checkbox" checked={e.requiresReason === true} onChange={(ev) => update({ requiresReason: ev.target.checked })} /> Ask for a reason when selected</label>
            <label className="check"><input type="checkbox" checked={e.otherDeptBringOwn === true} onChange={(ev) => update({ otherDeptBringOwn: ev.target.checked })} /> Not issued to other-department students (hidden for them — they bring their own)</label>
          </div>
        )}
      />
      <SaveBar busy={busy} error={error} onSave={() => save(items)} onReset={() => setItems(initial)} />
    </>
  );
}

function InstructionsEditor() {
  const { settings } = useAuth();
  const initial = settings.instructions || DEFAULT_INSTRUCTIONS;
  const [text, setText] = useState(initial.text);
  const { busy, error, save } = useSave('instructions');
  return (
    <section className="card">
      <div className="card-head"><h2>Lab rules & instructions</h2></div>
      <div className="card-body">
        <Field label="Shown to students before they sign" help="Plain text; line breaks are kept.">
          <textarea className="textarea" style={{ minHeight: 220 }} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <SaveBar busy={busy} error={error} onSave={() => save({ text })} onReset={() => setText(initial.text)} />
      </div>
    </section>
  );
}

function AcademicEditor() {
  const { settings } = useAuth();
  const initial = { ...DEFAULT_ACADEMIC_CALENDAR, ...(settings.academicCalendar || {}) };
  const [c, setC] = useState(initial);
  const { busy, error, save } = useSave('academicCalendar');
  const toast = useToast();
  const [preview, setPreview] = useState(null);
  const [dialog, setDialog] = useState(null);
  const runs = Object.entries(settings.academicCalendar?.lastRuns || {}).sort((a, b) => b[0].localeCompare(a[0]));

  const dryRun = async (event) => {
    try {
      setPreview({ event, ...(await call('runSemesterProgression', { event, dryRun: true })) });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head"><h2>Automatic semester progression</h2></div>
        <div className="card-body stack">
          <p className="small muted">
            August–December is the odd semester, January–May the even semester, June–July the break. A scheduled Cloud
            Function runs daily and applies each event once on its date. After the final semester (8, or 4 for MFM)
            students become <b>Graduated</b> — booking access is disabled; nothing is deleted.
          </p>
          <label className="check"><input type="checkbox" checked={c.autoProgression} onChange={(e) => setC({ ...c, autoProgression: e.target.checked })} /> Run automatically</label>
          <div className="grid grid-4">
            <Field label="Odd → Even (MM-DD)" help="Sem 1→2, 3→4, 5→6, 7→8"><input className="input mono" value={c.oddToEvenDate} onChange={(e) => setC({ ...c, oddToEvenDate: e.target.value })} /></Field>
            <Field label="Graduation (MM-DD)" help="After May"><input className="input mono" value={c.graduationDate} onChange={(e) => setC({ ...c, graduationDate: e.target.value })} /></Field>
            <Field label="Even → Odd (MM-DD)" help="Sem 2→3, 4→5, 6→7"><input className="input mono" value={c.evenToOddDate} onChange={(e) => setC({ ...c, evenToOddDate: e.target.value })} /></Field>
            <Field label="Catch-up window (days)"><input className="input" type="number" min={0} max={60} value={c.catchUpDays} onChange={(e) => setC({ ...c, catchUpDays: Number(e.target.value) })} /></Field>
          </div>
          <SaveBar busy={busy} error={error} onSave={() => save(c)} />
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Run manually</h2></div>
        <div className="card-body stack">
          <p className="small muted">Preview first — the preview changes nothing.</p>
          <div className="row">
            {Object.values(PROGRESSION_EVENTS).map((ev) => (
              <button key={ev} className="btn btn-sm" onClick={() => dryRun(ev)}>Preview: {PROGRESSION_LABELS[ev]}</button>
            ))}
          </div>
          {preview && (
            <div className="card card-pad" style={{ boxShadow: 'none' }}>
              <div className="row-between">
                <b>{PROGRESSION_LABELS[preview.event]} — {preview.count} student{preview.count === 1 ? '' : 's'} affected</b>
                <button
                  className="btn btn-accent btn-sm"
                  disabled={!preview.count}
                  onClick={() => setDialog({
                    title: 'Apply progression',
                    message: `Apply “${PROGRESSION_LABELS[preview.event]}” to ${preview.count} students now? This is logged.`,
                    confirmLabel: 'Apply now',
                    tone: 'accent',
                    onConfirm: async () => {
                      const r = await call('runSemesterProgression', { event: preview.event, dryRun: false });
                      toast(`Updated ${r.count} students`, 'ok');
                      setPreview(null);
                    },
                  })}
                >
                  Apply now
                </button>
              </div>
              <div className="small" style={{ marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
                {preview.sample?.map((s) => (
                  <div key={s.uid}>{s.name} ({s.niftId}) — Sem {s.from.semester} → {s.patch.semester ?? 'Graduated'}</div>
                ))}
              </div>
            </div>
          )}
          {runs.length > 0 && (
            <div className="small">
              <b>Automatic runs</b>
              {runs.map(([k, v]) => <div key={k} className="mono">{k} — {v.students ?? '…'} students · {formatDateTime(v.at)}</div>)}
            </div>
          )}
        </div>
      </section>
      {dialog && <ConfirmModal {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
