import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Modal, Field, Alert, ConfirmModal, useToast } from './ui.jsx';
import QrCode from './QrCode.jsx';
import { DEMO } from '../firebase.js';
import { SIGN_ORG } from '@shared/constants.js';
import { formatDateTime } from '@shared/calendar.js';

/** Link the QR code opens: the booking in the portal (with the code to check). */
export function verifyUrl(bookingId, code) {
  if (typeof window === 'undefined' || !bookingId) return '';
  const base = DEMO ? `${window.location.origin}${window.location.pathname}#` : window.location.origin;
  return `${base}/bookings/${bookingId}${code ? `?verify=${encodeURIComponent(code)}` : ''}`;
}

/**
 * A digital signature: QR code + "Digitally signed by …" card.
 * `sig` = { name, id, role, at, code } (see digitalSignature in shared/constants).
 * Scanning the QR opens the booking, so anyone can check it is genuine.
 */
export function DigitalStamp({ sig, bookingId, approved = false, preview = false }) {
  if (!sig) return null;
  const url = !preview && sig.code ? verifyUrl(bookingId, sig.code) : '';
  return (
    <div className={`dstamp ${preview ? 'preview' : ''} ${approved ? 'approved' : ''}`}>
      <div className="dstamp-qr">
        {url ? <QrCode text={url} size={64} label={`Verify signature ${sig.code}`} /> : <span>QR after<br />signing</span>}
      </div>
      <div className="dstamp-body">
        <div className="dstamp-label">
          <span className="dstamp-tick" aria-hidden>✓</span> {approved ? 'Approved · digitally signed' : 'Digitally signed'}
        </div>
        <div className="dstamp-name" title={sig.name}>{sig.name}</div>
        <div className="dstamp-meta">{[sig.id, sig.role].filter(Boolean).join(' · ')}</div>
        {sig.at && <div className="dstamp-meta">{formatDateTime(sig.at)}</div>}
        <div className="dstamp-code">{sig.code || `${SIGN_ORG} · code added on signing`}</div>
      </div>
    </div>
  );
}

/**
 * Approve with a digital signature (FC-CC). No drawing: the system stamps
 * "Digitally signed by <name>, FC-CC · FPL-NJ" with the time and a code.
 * onConfirm({ remarks })
 */
export function SignApproveModal({ title, message, confirmLabel = 'Sign & approve', tone = 'green', onConfirm, onClose }) {
  const { user } = useAuth();
  const [remarks, setRemarks] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = user?.displayName || user?.email || 'You';

  const submit = async () => {
    if (!agree) return setError('Please tick the box to sign digitally.');
    setBusy(true);
    setError('');
    try {
      await onConfirm({ remarks: remarks.trim() });
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
          <button className={`btn btn-${tone}`} onClick={submit} disabled={busy || !agree}>{busy ? 'Signing…' : confirmLabel}</button>
        </>
      }
    >
      {message && <div>{message}</div>}
      <div className="label">Your digital signature</div>
      <DigitalStamp sig={{ name, role: 'FC-CC' }} preview />
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <b>I approve this booking and sign it digitally.</b>
      </label>
      <Field label="Remarks (optional)">
        <textarea className="textarea" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
      </Field>
      <Alert kind="error">{error}</Alert>
    </Modal>
  );
}

/**
 * Dialog helper used by action buttons. onDialog({ kind: 'sign' | undefined, ... }):
 *  - default: confirm with optional remarks; onConfirm(remarks)
 *  - 'sign':  digital-signature approval; onConfirm({ remarks })
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
