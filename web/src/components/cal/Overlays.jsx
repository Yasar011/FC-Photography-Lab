import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';

/** Floating card anchored to a calendar event (Google Calendar style). */
export function Popover({ anchor, onClose, tools, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchor.right + 10;
    if (left + w > window.innerWidth - 8) left = anchor.left - w - 10;
    if (left < 8) left = Math.max(8, (window.innerWidth - w) / 2);
    const top = Math.min(Math.max(8, anchor.top), window.innerHeight - h - 8);
    setPos({ left, top });
  }, [anchor]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div className="popover" ref={ref} style={pos} role="dialog">
      <div className="popover-tools">
        {tools}
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </div>
      {children}
    </div>
  );
}

/** Right-hand sheet used for the booking form (full screen on phones). */
export function Drawer({ title, onClose, children, footer, closeLabel = 'Close' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={closeLabel}><Icon name="close" /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}
