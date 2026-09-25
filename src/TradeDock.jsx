import React, {useEffect, useRef} from 'react';
import {formatMoney} from './utils.js';

export default function TradeDock({amount, setAmount, onBuy, onSell, onCustom, busy, openingSignIn}) {
  const dock = useRef(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--dock-height', `${entry.target.getBoundingClientRect().height}px`);
    });
    observer.observe(dock.current);
    return () => observer.disconnect();
  }, []);
  const custom = ![20, 50, 100].includes(Number(amount));
  return <section ref={dock} className="trade-dock" aria-label="Choose an amount and buy or sell CFK">
    <div className="dock-inner">
      <div className="amount-heading"><strong>Choose your amount</strong><span>USD</span></div>
      <div className="amount-choices" role="group" aria-label="Amount in US dollars">
        {[20, 50, 100].map(value => <button key={value} aria-pressed={Number(amount) === value} onClick={() => setAmount(String(value))}>${value}</button>)}
        <button aria-pressed={custom} onClick={onCustom}>{custom ? formatMoney(Number(amount)) : 'Other'}</button>
      </div>
      <div className="trade-buttons">
        <button className="primary sell" disabled={busy} onClick={onSell}>Sell</button>
        <button className="primary buy" disabled={!Number(amount) || busy} onClick={onBuy}>Buy {formatMoney(Number(amount), false).replace('.00', '')} of CFK <span aria-hidden="true">→</span></button>
      </div>
      {openingSignIn && <p className="sign-in-progress" role="status">Opening secure sign-in…</p>}
    </div>
  </section>;
}
