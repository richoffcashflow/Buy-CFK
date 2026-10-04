import React, {useEffect, useRef, useState} from 'react';
import {formatMoney} from './utils.js';
import {validAmount} from './purchase-intent.js';

export default function TradeDock({amount, setAmount, onBuy, onSell, busy, canSell, openingSignIn, loading, unavailable, pending, onResume, onWarm}) {
  const dock = useRef(null), [editing,setEditing]=useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--dock-height', `${entry.target.getBoundingClientRect().height}px`);
    });
    observer.observe(dock.current);
    return () => observer.disconnect();
  }, []);
  const locked = busy || openingSignIn;
  const invalid = amount !== '' && !validAmount(amount);
  const custom = ![20, 50, 100].includes(Number(amount));
  return <section ref={dock} className="trade-dock" aria-label="Choose an amount and buy CFK">
    <div className="dock-inner">
      <div className="amount-heading"><strong>Choose your amount</strong><span>USD</span></div>
      <div className="amount-choices" role="group" aria-label="Amount in US dollars">
        {[20, 50, 100].map(value => <button key={value} disabled={locked||Boolean(pending)} aria-pressed={Number(amount) === value} onClick={() => {setEditing(false);setAmount(String(value));onWarm?.();}}>${value}</button>)}
        <label className={'inline-amount'+(custom?' selected':'')}>
          <span aria-hidden="true">$</span>
          <input aria-label="Custom amount in US dollars" aria-invalid={invalid} aria-describedby={invalid?'amount-error':undefined} inputMode="decimal" placeholder="Other" disabled={locked||Boolean(pending)} value={editing||custom?amount:''} onFocus={()=>{setEditing(true);if(!custom)setAmount('');onWarm?.();}} onChange={event=>{if(/^\d{0,7}(\.\d{0,2})?$/.test(event.target.value))setAmount(event.target.value);}} onKeyDown={event=>{if(event.key==='Enter'&&validAmount(amount)&&!locked&&!loading&&!unavailable&&!pending){event.preventDefault();onBuy();}}}/>
        </label>
      </div>
      {invalid&&<p id="amount-error" className="amount-error" role="status">Enter $0.01–$1,000,000.</p>}
      <div className={'trade-buttons'+(canSell&&!pending?'':' buy-only')}>
        {canSell&&!pending&&<button className="primary sell" disabled={locked} onClick={onSell}>Sell</button>}
        <button className="primary buy" disabled={locked||(!pending&&(loading||unavailable||!validAmount(amount)))} onPointerEnter={onWarm} onFocus={onWarm} onClick={pending?onResume:onBuy}>
          {openingSignIn?'Connecting your account…':busy?'Please wait…':pending?'Continue payment or trade':loading?'Connecting…':unavailable?'Buying unavailable':'Buy '+formatMoney(Number(amount)).replace('.00','')+' of CFK'}
        </button>
      </div>
      <p className="dock-fee-note">15% platform fee plus payment and network costs apply.</p>
    </div>
  </section>;
}
