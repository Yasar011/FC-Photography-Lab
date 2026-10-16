import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { useLive } from '../lib/hooks.js';
import { Loading, Alert } from '../components/ui.jsx';
import { useActionDialog } from '../components/SignApprove.jsx';
import { SpecialActions, FcccActions, useBookingSignatures, signatureEntries, handlingNotes } from '../components/BookingBits.jsx';
import Icon from '../components/Icon.jsx';
import { STATUS_META, STUDENT_TYPE_LABELS, ADMIN_GUARD_NOTE, specialStepsFor } from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime } from '@shared/calendar.js';

/**
 * Official A4 sheet with every signature:
 *  - special hours: student (digital) · [Dept CC / faculty — other depts] · Director (paper) · FC-CC (digital, APPROVED)
 *  - normal booking slip (optional): student (digital); approval shown as text
 * The FC Lab Assistant and Director's PA only pass the form on — no signature boxes.
 */
export default function PrintSheet() {
  const { bookingId } = useParams();
  const { isAdmin, role } = useAuth();
  const { value: b, loading } = useLive(`bookings/${bookingId}`, [bookingId]);
  const [openDialog, dialogNode] = useActionDialog();
  const sheetRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const version = b ? JSON.stringify([b.special?.steps, b.fcccApproval, b.fcApproval?.state]) : '';
  const { sigs } = useBookingSignatures(bookingId, version);

  // A4 PDF of the sheet — works even where the browser print dialog is blocked.
  const downloadPdf = async () => {
    setPdfBusy(true);
    setPdfError('');
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const canvas = await html2canvas(sheetRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const margin = 10;
      let w = 210 - margin * 2;
      let h = (canvas.height * w) / canvas.width;
      if (h > 297 - margin * 2) {
        h = 297 - margin * 2;
        w = (canvas.width * h) / canvas.height;
      }
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (210 - w) / 2, margin, w, h);
      pdf.save(`${bookingId}-${b?.isSpecial ? 'permission-form' : 'booking-slip'}.pdf`);
    } catch (err) {
      console.error(err);
      setPdfError('Could not create the PDF. Please use Print instead.');
    } finally {
      setPdfBusy(false);
    }
  };
  const printNow = () => {
    try {
      window.focus();
      setTimeout(() => window.print(), 50);
    } catch {
      setPdfError('Printing is blocked in this browser window. Use “Download PDF” and print the file.');
    }
  };

  if (loading) return <Loading />;
  if (!b) return <div className="print-wrap"><Alert kind="error">Booking not found or no access.</Alert></div>;
  const entries = signatureEntries(b, sigs);
  const approvedStamp = entries.some((e) => e.approved);
  const title = b.isSpecial ? 'FC Photography Lab — Special Hours Permission Form' : 'FC Photography Lab — Booking Slip';
  const route = specialStepsFor(b.studentType);

  return (
    <div className="print-wrap">
      <div className="row no-print" style={{ maxWidth: 820, margin: '0 auto 14px', justifyContent: 'space-between' }}>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => window.history.back()}><Icon name="chevronLeft" /> Back</button>
          <button className="btn btn-primary" onClick={printNow}><Icon name="print" /> Print</button>
          <button className="btn btn-tonal" onClick={downloadPdf} disabled={pdfBusy}><Icon name="external" /> {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}</button>
          <Link className="btn btn-ghost" to={`/bookings/${b.id}`}>Open booking</Link>
        </div>
        {isAdmin && b.isSpecial && <SpecialActions booking={b} role={role} onDialog={openDialog} compact hidePrint />}
        {isAdmin && !b.isSpecial && <FcccActions booking={b} role={role} onDialog={openDialog} compact />}
      </div>
      {!b.isSpecial && (
        <div className="no-print" style={{ maxWidth: 820, margin: '0 auto 12px' }}>
          <Alert kind="info">Optional — no printing is needed for normal bookings. Print only if a paper copy is wanted.</Alert>
        </div>
      )}
      {pdfError && <div className="no-print" style={{ maxWidth: 820, margin: '0 auto 12px' }}><Alert kind="error">{pdfError}</Alert></div>}

      <article className="print-sheet" ref={sheetRef}>
        <div className="row-between" style={{ borderBottom: '3px solid #111', paddingBottom: 12, marginBottom: 16, alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>National Institute of Fashion Technology, Jodhpur</div>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>Department of Fashion Communication</div>
            <h1 style={{ marginTop: 8 }}>{title}</h1>
          </div>
          <div className="right">
            <div style={{ fontSize: 11 }}>Booking ID</div>
            <div className="booking-id" style={{ fontSize: 20 }}>{b.id}</div>
            <div style={{ fontSize: 11 }}>Status: {STATUS_META[b.status]?.label}</div>
            {approvedStamp && <div className="print-stamp" style={{ marginTop: 6 }}>APPROVED</div>}
          </div>
        </div>

        <h3>Student details</h3>
        <table>
          <tbody>
            <tr><th>Name</th><td>{b.studentName}</td><th>NIFT ID</th><td className="mono">{b.niftId}</td></tr>
            <tr><th>Department / Sem</th><td>{b.department} · Semester {b.semester}</td><th>Student type</th><td>{STUDENT_TYPE_LABELS[b.studentType]}</td></tr>
            <tr><th>Phone</th><td>{b.phone}</td><th>Email</th><td>{b.email}</td></tr>
          </tbody>
        </table>

        <h3>Booking details</h3>
        <table>
          <tbody>
            <tr><th>Date</th><td>{formatDate(b.date, { weekday: true })}</td><th>Time</th><td>{formatRange(b.startHour, b.endHour)} ({b.duration} h)</td></tr>
            <tr><th>Purpose</th><td colSpan={3}>{b.purpose}</td></tr>
            <tr><th>Requirements</th><td colSpan={3}>{(b.equipmentList || []).join(', ')}</td></tr>
            {b.clsReason && <tr><th>CLS Class Room reason</th><td colSpan={3}>{b.clsReason}</td></tr>}
            {b.isSpecial && <tr><th>Reason for permission</th><td colSpan={3}>{(b.specialReasons || []).join(', ')} — outside regular lab hours</td></tr>}
            {b.fcStudent && <tr><th>FC student involved</th><td colSpan={3}>{b.fcStudent.name} ({b.fcStudent.niftId}) — {b.fcApproval?.state === 'APPROVED' ? `approved online ${formatDateTime(b.fcApproval.at)}` : 'pending'}</td></tr>}
            {b.senior && <tr><th>Senior student</th><td colSpan={3}>{b.senior.name} ({b.senior.niftId})</td></tr>}
            {b.faculty && <tr><th>Subject / Faculty</th><td colSpan={3}>{b.faculty.name} — {b.faculty.email}</td></tr>}
          </tbody>
        </table>

        <h3>Student declaration</h3>
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{b.declaration?.text}</p>

        <h3>Signatures</h3>
        <div className="signgrid" style={{ gridTemplateColumns: `repeat(${Math.min(entries.length, 4)}, 1fr)` }}>
          {entries.map((e, i) => (
            <div key={e.key}>
              <span className="step">{i + 1} · {e.role}</span>
              {e.approved && <span className="print-stamp">APPROVED</span>}
              {e.img ? (
                <img src={e.img} alt={`${e.role} signature`} />
              ) : (
                <span style={{ fontSize: 11.5, color: '#555' }}>
                  {e.paper ? `${e.role} — sign here:` : e.pending ? '' : 'Signed in system'}
                </span>
              )}
              <span className="line">
                {e.paper ? (e.at ? `Verified · ${formatDateTime(e.at)}` : 'Signature & date') : `${e.name || 'Name'} ${e.at ? `· ${formatDateTime(e.at)}` : '· Date'}`}
              </span>
            </div>
          ))}
        </div>

        {handlingNotes(b).length > 0 && (
          <p style={{ fontSize: 11.5, color: '#444', marginTop: 8 }}>{handlingNotes(b).join(' · ')}</p>
        )}
        {b.isSpecial ? (
          <>
            <ol style={{ fontSize: 12, marginTop: 14, paddingLeft: 18 }}>
              {route.map((x) => <li key={x.key}>{x.todo}.</li>)}
            </ol>
            <p style={{ fontSize: 14, fontWeight: 800, marginTop: 10, borderTop: '2px solid #111', paddingTop: 8 }}>{ADMIN_GUARD_NOTE}</p>
          </>
        ) : (
          <p style={{ fontSize: 12, marginTop: 14 }}>
            Approved and digitally signed by the FC-CC in the portal. No printing is required — this slip is optional. Carry your NIFT ID to the session.
          </p>
        )}
        <div style={{ marginTop: 18, fontSize: 11, color: '#555', display: 'flex', justifyContent: 'space-between' }}>
          <span>Generated {formatDateTime(Date.now())} · FC Photography Lab booking system · digitally signed record</span>
          <span className="stamp">{b.id}</span>
        </div>
      </article>
      {dialogNode}
    </div>
  );
}
