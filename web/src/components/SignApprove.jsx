import { useEffect, useState } from 'react';
import { call } from '../firebase.js';
import SignaturePad from './SignaturePad.jsx';
import { Modal, Field, Alert, ConfirmModal, useToast } from './ui.jsx';

/** Shrink a photo to ≤1600px JPEG so uploads stay small. */
async function compressPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Load / draw the approver's signature. Returns { signature, ready, ui }. */
function useApproverSignature() {
  const [saved, setSaved] = useState(undefined); // undefined = loading
  const [drawNew, setDrawNew] = useState(false);
  const [drawn, setDrawn] = useState('');
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    call('getMySignature').then((r) => setSaved(r.dataUrl || null)).catch(() => setSaved(null));
  }, []);
  const usingSaved = saved && !drawNew;
  return {
    saved,
    usingSaved,
    drawn,
    remember,
    ready: Boolean(usingSaved || drawn),
    ui: saved === undefined ? (
      <p className="small muted">Loading your signature…</p>
    ) : usingSaved ? (
      <div className="stack" style={{ gap: 8 }}>
        <img className="sigimg" src={saved} alt="Your saved signature" />
        <div className="row">
          <span className="small muted">Your saved signature will be applied with your name and the time.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrawNew(true)}>Draw a new one</button>
        </div>
      </div>
    ) : (
      <div className="stack" style={{ gap: 8 }}>
        <SignaturePad submitted={Boolean(drawn)} onSubmit={setDrawn} onClear={() => setDrawn('')} />
        <label className="check small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Save as my signature for future approvals
        </label>
      </div>
    ),
  };
}

/**
 * Approve with a digital signature (FC-CC final approval of special bookings).
 * onConfirm({ signature, remarks, document }) — signature is null when the
 * saved signature should be used (the server copies it).
 */
export function SignApproveModal({ title, message, confirmLabel = 'Sign & approve', tone = 'green', allowDocument = false, onConfirm, onClose }) {
  const sig = useApproverSignature();
  const [remarks, setRemarks] = useState('');
  const [doc, setDoc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!sig.ready) return setError('Please draw your signature and press “Submit Signature”.');
    setBusy(true);
    setError('');
    try {
      if (!sig.usingSaved && sig.remember) await call('saveMySignature', { signature: sig.drawn });
      await onConfirm({ signature: sig.usingSaved ? null : sig.drawn, remarks: remarks.trim(), document: doc || null });
      onClose();
    } catch (e) {
      setError(e.message);
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
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Back</button>
          <button className={`btn btn-${tone}`} onClick={submit} disabled={busy || !sig.ready}>{busy ? 'Signing…' : confirmLabel}</button>
        </>
      }
    >
      {message && <div>{message}</div>}
      <div className="label">Your digital signature</div>
      {sig.ui}
      {allowDocument && (
        <Field label="Photo of the Director-signed form (optional)" help="Attach a photo or scan so everyone can see the Director's signature.">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setDoc(f ? await compressPhoto(f) : '');
            }}
          />
          {doc && <img src={doc} alt="Attached signed form" style={{ maxWidth: 220, borderRadius: 8, border: '1px solid var(--line)' }} />}
        </Field>
      )}
      <Field label="Remarks (optional)">
        <textarea className="textarea" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
      </Field>
      <Alert kind="error">{error}</Alert>
    </Modal>
  );
}

/** Admin: draw and save the signature used to stamp approvals. */
export function MySignatureModal({ onClose }) {
  const toast = useToast();
  const [saved, setSaved] = useState(undefined);
  const [drawn, setDrawn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    call('getMySignature').then((r) => setSaved(r.dataUrl || null)).catch(() => setSaved(null));
  }, []);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await call('saveMySignature', { signature: drawn });
      toast('Signature saved', 'ok');
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="My approval signature"
      onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={save} disabled={!drawn || busy}>{busy ? 'Saving…' : 'Save signature'}</button></>}
    >
      <p className="small muted">This signature is stamped (with your name and the time) on the forms and slips you approve. Each approval keeps its own copy, so changing it later never alters past records.</p>
      {saved && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="label">Current</div>
          <img className="sigimg" src={saved} alt="Current saved signature" />
        </div>
      )}
      <div className="label">{saved ? 'Draw a new signature' : 'Draw your signature'}</div>
      <SignaturePad submitted={Boolean(drawn)} onSubmit={setDrawn} onClear={() => setDrawn('')} />
      <Alert kind="error">{error}</Alert>
    </Modal>
  );
}

/**
 * Dialog helper used by action buttons. onDialog({ kind: 'sign' | undefined, ... }):
 *  - default: confirm with optional remarks; onConfirm(remarks)
 *  - 'sign':  digital-signature approval; onConfirm({ signature, remarks, document })
 * onConfirm may return a success message, which is shown as a toast.
 */
export function useActionDialog() {
  const toast = useToast();
  const [dialog, setDialog] = useState(null);
  const open = (d) =>
    setDialog({
      ...d,
      onConfirm: async (arg) => {
        const msg = await d.onConfirm(arg);
        if (msg) toast(msg, 'ok');
      },
    });
  const close = () => setDialog(null);
  let node = null;
  if (dialog?.kind === 'sign') node = <SignApproveModal {...dialog} onClose={close} />;
  else if (dialog) node = <ConfirmModal {...dialog} onClose={close} />;
  return [open, node];
}
