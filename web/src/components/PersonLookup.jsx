import { useEffect, useRef, useState } from 'react';
import { call } from '../firebase.js';
import { normalizeNiftId, isValidNiftId } from '@shared/constants.js';
import { Field, TypeBadge } from './ui.jsx';

/**
 * Pick a registered student by typing their name or NIFT ID. Only eligible,
 * active students are suggested (server-side), with public fields only.
 * `value` is the chosen student or null.
 */
export default function PersonLookup({ label, purpose, value, onChange, help, required }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const search = (q) => {
    clearTimeout(timer.current);
    setMsg('');
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await call('searchStudents', { query: q.trim(), purpose });
        setResults(r.results || []);
        setOpen(true);
        if (!r.results?.length) {
          // Exact NIFT ID typed? Explain why that student can't be chosen.
          if (isValidNiftId(q)) {
            const one = await call('lookupStudent', { niftId: normalizeNiftId(q), purpose });
            setMsg(!one.found ? 'No registered student with this NIFT ID — they must sign in and register first.' : `${one.student.name}: ${one.reason}`);
          } else {
            setMsg(purpose === 'fc' ? 'No matching FC student found.' : 'No matching student found.');
          }
        }
      } catch (err) {
        setMsg(err.message);
      } finally {
        setBusy(false);
      }
    }, 300);
  };

  const pick = (s) => {
    onChange(s);
    setText('');
    setResults([]);
    setOpen(false);
    setMsg('');
  };

  if (value) {
    return (
      <Field label={label} required={required}>
        <div className="person-chip">
          <span className="avatar" style={{ width: 34, height: 34, fontSize: 13 }}>{value.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
          <span className="grow">
            <div style={{ fontWeight: 600 }}>{value.name}</div>
            <div className="small muted">{value.niftId} · {value.department} · Sem {value.semester}</div>
          </span>
          <TypeBadge type={value.studentType} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>Change</button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} required={required} help={help}>
      <div className="lookup" ref={boxRef}>
        <input
          className="input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            search(e.target.value);
          }}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (results[0]) pick(results[0]);
            }
          }}
          placeholder="Type a name or NIFT ID…"
          autoComplete="off"
          aria-autocomplete="list"
        />
        {busy && <span className="lookup-busy spinner" />}
        {open && results.length > 0 && (
          <ul className="lookup-list" role="listbox">
            {results.map((s) => (
              <li key={s.niftId}>
                <button type="button" onClick={() => pick(s)}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span className="small muted"> · {s.niftId} · {s.department} · Sem {s.semester}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {msg && <div className="alert alert-error small" style={{ marginTop: 6 }}>{msg}</div>}
    </Field>
  );
}
