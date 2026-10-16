import { addDays, dayOfWeek, todayIST } from '@shared/calendar.js';
import Icon from '../Icon.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Small month calendar (Google Calendar side panel). Weeks start on Monday. */
export default function MiniMonth({ month, onMonth, selected, highlight = [], isEnabled = () => true, marks, holidays = {}, onSelect }) {
  const first = `${month}-01`;
  const dow = dayOfWeek(first);
  const start = addDays(first, dow === 0 ? -6 : 1 - dow);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = todayIST();
  const [y, m] = month.split('-').map(Number);
  return (
    <div className="mm">
      <div className="mm-head">
        <span className="t">{MONTHS[m - 1]} {y}</span>
        <span>
          <button className="icon-btn" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month"><Icon name="chevronLeft" size={18} /></button>
          <button className="icon-btn" onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month"><Icon name="chevronRight" size={18} /></button>
        </span>
      </div>
      <div className="mm-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="dw">{d}</span>)}
        {days.map((d) => {
          const cls = [
            d.slice(0, 7) !== month && 'other',
            d === today && 'today',
            d === selected && 'sel',
            highlight.includes(d) && 'inweek',
            marks?.has(d) && 'mark',
            holidays[d] && !holidays[d].open && 'holiday',
          ].filter(Boolean).join(' ');
          return (
            <button key={d} className={cls} disabled={!isEnabled(d)} onClick={() => onSelect(d)} aria-label={d}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
