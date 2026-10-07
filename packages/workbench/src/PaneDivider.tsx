import React, { useEffect, useRef, useState } from 'react';

export function PaneDivider() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340); const [maxWidth, setMaxWidth] = useState(600);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const apply = (requested: number) => {
    const parent = ref.current?.parentElement; if (!parent) return;
    const maximum = Math.max(260, Math.min(600, parent.clientWidth - 368));
    const value = Math.round(Math.max(260, Math.min(maximum, requested)));
    parent.style.setProperty('--ai-panel-width', `${value}px`); setWidth(value); setMaxWidth(maximum);
    try { localStorage.setItem('dbpilot-ai-pane-width', String(value)); } catch { /* Storage may be disabled. */ }
  };
  useEffect(() => {
    const parent = ref.current?.parentElement; if (!parent) return;
    let preferred = 340; try { const saved = Number(localStorage.getItem('dbpilot-ai-pane-width')); if (Number.isFinite(saved) && saved >= 260) preferred = saved; } catch { /* Default width. */ }
    apply(preferred);
    const observer = new ResizeObserver(() => { if (parent.clientWidth > 628) { const current = Number.parseFloat(parent.style.getPropertyValue('--ai-panel-width')); apply(current || preferred); } }); observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="pane-divider" role="separator" tabIndex={0} aria-label="调整工作区与 AI 对话区宽度" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={maxWidth} aria-valuenow={width} aria-valuetext={`AI 对话区宽度 ${width} 像素`} title="拖动调整宽度；方向键微调；双击恢复默认"
    onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); }}
    onPointerMove={event => { if (drag.current) apply(drag.current.width + drag.current.x - event.clientX); }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={() => apply(340)}
    onKeyDown={event => { const step = event.shiftKey ? 40 : 10; if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); apply(event.key === 'Home' ? 260 : event.key === 'End' ? maxWidth : width + (event.key === 'ArrowLeft' ? step : -step)); } }}><span /></div>;
}
