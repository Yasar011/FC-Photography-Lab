import { useEffect, useRef, useState } from 'react';

/**
 * Draw-on-screen signature. Calls onSubmit(dataUrl) when the student presses
 * "Submit Signature"; onClear() when cleared.
 */
export default function SignaturePad({ onSubmit, onClear, onDraw, submitted }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const strokes = useRef(0);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const { width, height } = canvas.getBoundingClientRect();
      const data = hasInk ? canvas.toDataURL() : null;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2.2;
      if (data) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, width, height);
        img.src = data;
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e) => {
    if (submitted) return;
    e.preventDefault();
    try {
      canvasRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* keep drawing even if capture is unavailable */
    }
    drawing.current = true;
    last.current = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    strokes.current += 1;
    if (!hasInk && strokes.current > 8) setHasInk(true);
  };
  const up = () => {
    if (drawing.current && strokes.current > 8) onDraw?.(exportPng());
    drawing.current = false;
  };

  const clear = () => {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    strokes.current = 0;
    setHasInk(false);
    onClear?.();
  };

  // Export on a white background, trimmed to a sensible size.
  const exportPng = () => {
    const src = canvasRef.current;
    const out = document.createElement('canvas');
    const w = Math.min(src.width, 900);
    const h = Math.round((src.height / src.width) * w);
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    return out.toDataURL('image/png');
  };
  const submit = () => onSubmit(exportPng());

  return (
    <div className="stack">
      <div className="sigpad" style={submitted ? { borderColor: 'var(--green)', borderStyle: 'solid' } : undefined}>
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          aria-label="Signature area — draw your signature"
        />
        <div className="baseline" />
        <div className="hint">{submitted ? 'Signature submitted ✓' : 'Sign above the line'}</div>
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={clear}>Clear Signature</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!hasInk || submitted}>
          {submitted ? 'Signature saved ✓' : 'Submit Signature'}
        </button>
      </div>
    </div>
  );
}
