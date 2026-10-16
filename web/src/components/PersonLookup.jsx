import { useState } from 'react';
import { call } from '../firebase.js';
import { normalizeNiftId } from '@shared/constants.js';
import { Field, TypeBadge } from './ui.jsx';

/**
 * Find a registered student by NIFT ID (server-side lookup returns only
 * name / department / semester / type). `value` is the found student or null.
 */
export default function PersonLookup({ label, purpose, value, onChange, help, required }) {
  const [id, setId] = useState(value?.niftId || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const find = async () => {
    const niftId = normalizeNiftId(id);
    if (!niftId) return;
    setBusy(true);
    setMsg('');
    onChange(null);
    try {
      const r = await call('lookupStudent', { niftId, purpose });
      if (!r.found) setMsg('No registered student with this NIFT ID. They must sign in and register first.');
      else if (!r.eligible) setMsg(`${r.student.name}: ${r.reason}`);
      else onChange(r.student);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="grid grid-2">
        <Field label={`${label} — NIFT ID`} required={required} help={help}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              className="input mono"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                if (value) onChange(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), find())}
              placeholder="FC/23/101"
              autoCapitalize="characters"
            />
            <button type="button" className="btn" onClick={find} disabled={busy || !id.trim()}>
              {busy ? '…' : 'Find'}
            </button>
          </div>
        </Field>
        <Field label={`${label} — Name`}>
          <input className="input" value={value?.name || ''} readOnly placeholder="Filled automatically" />
        </Field>
      </div>
      {value && (
        <div className="alert alert-ok small">
          <span>
            ✓ <b>{value.name}</b> · {value.niftId} · {value.department} · Semester {value.semester}
          </span>
          <TypeBadge type={value.studentType} />
        </div>
      )}
      {msg && <div className="alert alert-error small">{msg}</div>}
    </div>
  );
}
