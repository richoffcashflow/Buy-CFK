import React, {useEffect, useId, useMemo, useState} from 'react';
import {formatMoney} from './utils.js';
import {cleanPoints, nearestPoint, priceDomain} from './chart-model.js';

export default function PriceChart({points, message, loading, historyStart, onInspect}) {
  const data = useMemo(() => cleanPoints(points), [points]);
  const [selectedTime, setSelectedTime] = useState(null);
  const [windowRange, setWindowRange] = useState(null);
  const gradient = useId().replace(/:/g, '');
  const first = data[0]?.[0] ?? 0, last = data.at(-1)?.[0] ?? 1;
  const [start, end] = windowRange ?? [first, last];
  const visible = useMemo(() => data.filter(p => p[0] >= start && p[0] <= end), [data, start, end]);
  const [low, high] = priceDomain(visible);
  const span = Math.max(end - start, 1);
  const x = time => end === start ? 280 : (time - start) / span * 560;
  const y = price => 210 - (price - low) / (high - low) * 210;
  const selectedIndex = nearestPoint(visible, selectedTime ?? last);
  const selected = visible[selectedIndex];
  const path = visible.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(2)},${y(p[4]).toFixed(2)}`).join(' ');
  const inspecting = selectedTime !== null && !!selected;
  const timeLabel = time => new Date(time * 1000).toLocaleString([], {
    ...(end - start > 86400 ? {month: 'short', day: 'numeric'} : {}), hour: 'numeric', minute: '2-digit'
  });
  useEffect(() => { onInspect(inspecting ? selected : null); }, [inspecting, selected, onInspect]);
  useEffect(() => () => onInspect(null), [onInspect]);

  function inspect(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    setSelectedTime(start + fraction * span);
  }
  function zoom(factor) {
    const fullSpan = last - first;
    const nextSpan = Math.min(fullSpan, Math.max(fullSpan / 16, (end - start) * factor));
    if (nextSpan >= fullSpan) { setWindowRange(null); return; }
    const center = selected?.[0] ?? (start + end) / 2;
    const nextStart = Math.max(first, Math.min(last - nextSpan, center - nextSpan / 2));
    setWindowRange([nextStart, nextStart + nextSpan]);
  }
  function keyboard(event) {
    if (!visible.length) return;
    let index = selectedIndex;
    if (event.key === 'ArrowLeft') index--;
    else if (event.key === 'ArrowRight') index++;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = visible.length - 1;
    else if (event.key === 'Escape') { setSelectedTime(null); return; }
    else return;
    event.preventDefault();
    setSelectedTime(visible[Math.max(0, Math.min(visible.length - 1, index))][0]);
  }
  return <div className="chart" aria-label="CFK price history in US dollars" aria-busy={loading}>
    {data.length ? <>
      <div className="chart-stage">
        <div className="chart-plot" role="slider" tabIndex={0} aria-label="Explore CFK price history"
          aria-valuemin={0} aria-valuemax={Math.max(0, visible.length - 1)} aria-valuenow={Math.max(0, selectedIndex)}
          aria-valuetext={selected ? `${formatMoney(selected[4], true)} at ${timeLabel(selected[0])}` : 'No price in this view'}
          onKeyDown={keyboard} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); inspect(event); }}
          onPointerMove={inspect} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerLeave={event => { if (event.pointerType === 'mouse' && !event.buttons) setSelectedTime(null); }}
          onPointerCancel={() => setSelectedTime(null)}>
          <svg viewBox="0 0 560 210" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--blue)" stopOpacity=".24"/><stop offset="100%" stopColor="var(--blue)" stopOpacity=".015"/></linearGradient></defs>
            {[0, 70, 140, 210].map(tick => <line key={tick} x1="0" x2="560" y1={tick} y2={tick} stroke="var(--line)" vectorEffect="non-scaling-stroke"/>)}
            {visible.length > 1 && <><path d={`${path} L${x(visible.at(-1)[0])},210 L${x(visible[0][0])},210 Z`} fill={`url(#${gradient})`}/><path d={path} fill="none" stroke="var(--blue)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/></>}
            {selected && <><line x1="0" x2="560" y1={y(selected[4])} y2={y(selected[4])} stroke="var(--blue)" opacity=".45" strokeDasharray="3 4" vectorEffect="non-scaling-stroke"/>{inspecting && <line x1={x(selected[0])} x2={x(selected[0])} y1="0" y2="210" stroke="#92a1b1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/>}</>}
          </svg>
          {selected && <span className="chart-dot" style={{left: `${x(selected[0]) / 5.6}%`, top: `${y(selected[4]) / 2.1}%`}}/>}
          {inspecting && <div className="chart-tooltip" style={{left: `${Math.max(27, Math.min(73, x(selected[0]) / 5.6))}%`}}><strong>{formatMoney(selected[4], true)}</strong><span>{timeLabel(selected[0])}</span></div>}
        </div>
        <div className="chart-axis" aria-hidden="true">{[high, low + (high - low) * 2 / 3, low + (high - low) / 3, low].map((price, i) => <span key={i}>{formatMoney(price, true)}</span>)}</div>
      </div>
      <div className="chart-dates"><span>{timeLabel(start)}</span><span>{timeLabel(end)}</span></div>
      <div className="chart-controls"><span>{data.length === 1 ? 'First price recorded' : 'Drag to explore price'}</span><div role="group" aria-label="Chart zoom">{inspecting && <button className="zoom-reset" onClick={() => setSelectedTime(null)}>Latest</button>}<button aria-label="Zoom out" disabled={!windowRange} onClick={() => zoom(2)}>−</button><button aria-label="Zoom in" disabled={visible.length < 3 || (end - start) <= (last - first) / 16} onClick={() => zoom(.5)}>+</button>{windowRange && <button className="zoom-reset" onClick={() => { setWindowRange(null); setSelectedTime(null); }}>Reset</button>}</div></div>
      {historyStart && <p className="history-note">Recorded history from {new Date(historyStart).toLocaleDateString([], {month: 'short', day: 'numeric'})}</p>}
    </> : <div className="chart-empty">{loading && <span className="spinner"/>}<strong>{message}</strong><span>{loading ? 'Getting the latest prices' : 'Prices appear as they are recorded.'}</span></div>}
  </div>;
}
