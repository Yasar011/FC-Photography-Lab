import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { STATUS_META, STUDENT_TYPE_LABELS, ACCOUNT_STATUS_LABELS } from '@shared/constants.js';

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, tone: 'grey' };
  return <span className={`badge tone-${meta.tone}`}>{meta.label}</span>;
}

const ACCOUNT_TONES = { ACTIVE: 'green', GRADUATED: 'blue', DISABLED: 'black' };
export function AccountBadge({ status }) {
  return <span className={`badge tone-${ACCOUNT_TONES[status] || 'grey'}`}>{ACCOUNT_STATUS_LABELS[status] || status}</span>;
}

const TYPE_TONES = { FC_STUDENT: 'violet', FC_IDM_STUDENT: 'blue', OTHER_DEPT_STUDENT: 'grey' };
export function TypeBadge({ type }) {
  return <span className={`badge plain tone-${TYPE_TONES[type] || 'grey'}`}>{STUDENT_TYPE_LABELS[type] || type || '—'}</span>;
}

export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="center-screen">
      <div className="row muted">
        <Spinner /> {label}
      </div>
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function Alert({ kind = 'info', children }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>;
}

export function Field({ label, required, help, children, htmlFor }) {
  return (
    <div className="field">
      {label && (
        <label htmlFor={htmlFor}>
          {label} {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {help && <div className="help">{help}</div>}
    </div>
  );
}

export function PageHead({ eyebrow, title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirm dialog with an optional/required remarks field. */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary',
  remarks = 'none', // 'none' | 'optional' | 'required'
  remarksLabel = 'Remarks',
  onConfirm,
  onClose,
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (remarks === 'required' && !text.trim()) {
      setError(`${remarksLabel} is required.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Back</button>
          <button className={`btn btn-${tone}`} onClick={submit} disabled={busy}>
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </>
      }
    >
      {message && <div>{message}</div>}
      {remarks !== 'none' && (
        <Field label={remarksLabel} required={remarks === 'required'}>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus maxLength={1000} />
        </Field>
      )}
      <Alert kind="error">{error}</Alert>
    </Modal>
  );
}

// ---- Toasts ---------------------------------------------------------------
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

export function Camera({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="6.5" width="19" height="13" rx="2.5" stroke="#1a1a1a" strokeWidth="1.8" />
      <circle cx="12" cy="13" r="4" stroke="#1a1a1a" strokeWidth="1.8" />
      <circle cx="12" cy="13" r="1.4" fill="#b3261e" />
      <path d="M8 6.5 9.5 4h5L16 6.5" stroke="#1a1a1a" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
