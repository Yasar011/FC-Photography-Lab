import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../lib/auth.jsx';
import { useNow } from '../../lib/hooks.js';
import { call } from '../../firebase.js';
import { PageHead } from '../../components/ui.jsx';
import { useActionDialog } from '../../components/SignApprove.jsx';
import { SpecialActions, nextSpecialStep } from '../../components/BookingBits.jsx';
import { ApprovalTabs, ApprovalList } from '../../components/ApprovalList.jsx';
import { useStatusList } from './AdminDashboard.jsx';
import Icon from '../../components/Icon.jsx';
import { STATUS, specialStepsFor } from '@shared/constants.js';
import { formatDate, formatRange, formatDateTime } from '@shared/calendar.js';

/**
 * Special approvals (after 10 PM · weekend · holiday) — same simple list as Approvals:
 *  • Print form:     FC Lab Assistant prints the form and hands it to the student
 *  • Final approval: form is with the student for paper signatures; FC-CC signs when it is back
 *  • Approved:       upcoming approved special bookings (student gives the form to the Admin Guard)
 */
export default function SpecialApprovals() {
  const { role, isFccc } = useAuth();
  const now = useNow(60000);
  const pending = useStatusList(STATUS.PENDING_SPECIAL_APPROVAL);
  const approved = useStatusList(STATUS.APPROVED);
  const [openDialog, dialogNode] = useActionDialog();
  const [tab, setTab] = useState(isFccc ? 'final' : 'print');

  const byStart = (a, b) => a.startAt - b.startAt;
  const toPrint = pending.items.filter((b) => nextSpecialStep(b)?.key === 'fcAssistant').sort(byStart);
  const toFinal = pending.items.filter((b) => nextSpecialStep(b)?.key === 'final').sort(byStart);
  const upcoming = approved.items.filter((b) => b.isSpecial && b.endAt > now).sort(byStart);

  const signers = (b) => specialStepsFor(b.studentType).filter((s) => s.paper && s.signs).map((s) => s.label);

  const cancel = (b) =>
    openDialog({
      title: `Cancel ${b.id}`,
      message: `Cancel ${b.studentName}'s booking (${formatDate(b.date, { weekday: true })} · ${formatRange(b.startHour, b.endHour)})? The slot is released and the student is emailed.`,
      confirmLabel: 'Cancel booking',
      tone: 'danger',
      remarks: 'required',
      remarksLabel: 'Reason (sent to the student)',
      onConfirm: async (reason) => {
        await call('cancelBooking', { bookingId: b.id, reason });
        return 'Booking cancelled';
      },
    });

  const tabs = [
    { key: 'print', label: 'Print form', n: toPrint.length, hot: true, hint: 'FC Lab Assistant: print the form and hand it to the student.' },
    { key: 'final', label: 'Final approval', n: toFinal.length, hot: true, hint: isFccc ? 'The student brings back the signed paper form. Check the signatures, then Sign & approve.' : 'With the student for signatures. Only the FC-CC gives the final approval.' },
    { key: 'approved', label: 'Approved', n: upcoming.length, hint: 'Fully approved. The student gives the signed form to the Admin Guard.' },
  ];
  const current = tabs.find((t) => t.key === tab);
  const list = tab === 'print' ? toPrint : tab === 'final' ? toFinal : upcoming;

  const actionsFor = (b) => {
    if (tab === 'print') return <SpecialActions booking={b} role={role} onDialog={openDialog} compact />;
    if (tab === 'final') {
      return isFccc
        ? <SpecialActions booking={b} role={role} onDialog={openDialog} compact hidePrint />
        : <span className="small muted">With student · waiting for FC-CC</span>;
    }
    return (
      <div className="row" style={{ gap: 8 }}>
        <Link className="btn btn-sm btn-ghost" to={`/print/${b.id}`}><Icon name="print" /> Form</Link>
        {isFccc && <button className="btn btn-sm btn-ghost" onClick={() => cancel(b)}>Cancel</button>}
      </div>
    );
  };

  const noteFor = (b) => {
    if (tab !== 'final') return null;
    const issued = b.special?.steps?.fcAssistant;
    return `Needs signatures: ${signers(b).join(' → ')}${issued ? ` · form issued ${formatDateTime(issued.at)}` : ''}`;
  };

  return (
    <>
      <PageHead eyebrow="After 10 PM · Weekend · Holiday" title="Special approvals">
        <span className="live-dot">Live</span>
      </PageHead>
      <ApprovalTabs tabs={tabs} tab={tab} onChange={setTab} />
      <p className="small muted" style={{ margin: '0 0 12px' }}>{current.hint}</p>
      {pending.loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ApprovalList
          items={list}
          actionsFor={actionsFor}
          noteFor={noteFor}
          tagsFor={(b) => <span className="appr-tag special">{(b.specialReasons || []).join(', ') || 'Special'}</span>}
        />
      )}
      {dialogNode}
    </>
  );
}
