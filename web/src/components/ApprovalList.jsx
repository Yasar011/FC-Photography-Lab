import { Link } from 'react-router-dom';

import Icon from './Icon.jsx';
import { STUDENT_TYPE_LABELS } from '@shared/constants.js';
import { formatDate, formatRange, todayIST } from '@shared/calendar.js';

/** Tabs with counts — `tabs` = [{ key, label, n, hot }]. */
export function ApprovalTabs({ tabs, tab, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          {t.label} <span className={`tab-n ${t.n && t.hot ? 'hot' : ''}`}>{t.n}</span>
        </button>
      ))}
    </div>
  );
}

/** One compact row per booking: when · who / what · actions. */
export function ApprovalList({ items, actionsFor, tagsFor, noteFor }) {
  const today = todayIST();
  if (!items.length) return <div className="appr-empty"><Icon name="check" /> Nothing here.</div>;
  return (
    <div className="appr-list">
      {items.map((b) => (
        <div key={b.id} className="appr-row">
          <Link to={`/bookings/${b.id}`} className="appr-when">
            <b>{b.date === today ? 'Today' : formatDate(b.date, { weekday: true })}</b>
            <span>{formatRange(b.startHour, b.endHour)}</span>
          </Link>
          <Link to={`/bookings/${b.id}`} className="appr-main">
            <div className="appr-name">
              {b.studentName}
              <span className="appr-tag">{STUDENT_TYPE_LABELS[b.studentType]}</span>
              {tagsFor?.(b)}
            </div>
            <div className="small muted appr-purpose">{b.purpose}</div>
            {noteFor?.(b) && <div className="tiny appr-note">{noteFor(b)}</div>}
          </Link>
          <div className="appr-actions">{actionsFor(b)}</div>
        </div>
      ))}
    </div>
  );
}
