import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {cardConversionAmounts} from './card-policy.js';
import './card-preview.css';

const money = value => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(value);
function Glyph({name, size = 22}) {
  const paths = {arrow: 'M7 17 17 7M7 7h10v10', back: 'm14 6-6 6 6 6', plus: 'M12 5v14M5 12h14',
    card: 'M3 8h18M5 16h4M4 4h16a1 1 0 0 1 1 1v14H3V5a1 1 0 0 1 1-1Z',
    home: 'm3 10 9-7 9 7v11h-7v-7h-4v7H3Z', check: 'm5 12 4 4L19 6',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z', chart: 'm3 17 5-5 4 2 9-10',
    wallet: 'M3 7h18v14H3V4h15v3M16 12h5v5h-5Z', snow: 'M12 2v20M3 7l18 10M3 17 21 7'};
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.arrow}/></svg>;
}
function CardArt({frozen = false}) {
  return <div className={'cfk-plastic'+(frozen?' frozen':'')} aria-label="CFK card design preview">
    <div className="plastic-top"><span>CASHFLOW</span><img src="/assets/cashflow-logo-transparent.png" alt="Cashflow emblem" width="56" height="56"/></div>
    <div className="chip" aria-hidden="true"><i/><i/><i/></div>
    <div className="plastic-number">•••• <span>••••</span> <span>••••</span> 4289</div>
    <div className="plastic-bottom"><span>CFK CARD</span><span>{frozen?'FROZEN':'DEBIT'}</span></div>
  </div>;
}
function Preview() {
  const [screen, setScreen] = useState('coin'), [amount, setAmount] = useState('100'), [balance, setBalance] = useState(0),
    [activated, setActivated] = useState(false), [frozen, setFrozen] = useState(false), [message, setMessage] = useState(''), [tab, setTab] = useState('home');
  const gross = Number(amount), valid = Number.isFinite(gross) && gross > 0 && gross <= 250;
  const quote = valid ? cardConversionAmounts(BigInt(Math.round(gross * 1e6))) : null;
  const net = quote ? Number(quote.net) / 1e6 : 0;
  const go = next => {setMessage(''); setScreen(next); window.scrollTo({top: 0});};
  function completeSale() {setBalance(value => value + net); setActivated(true); setTab('home'); go('account'); setMessage(`${money(net)} added to your sample card balance.`);}
  return <><div className="preview-label">INTERACTIVE DESIGN PREVIEW <span>Sample balances · No money moves</span></div>
    <main className="cashflow-shell">
      <header className="account-header"><div className="wordmark"><img src="/assets/cashflow-favicon-transparent.png" alt=""/><span>CASHFLOW<span className="wordmark-sub">{activated?'YOUR CFK ACCOUNT':'BUY CFK'}</span></span></div><span className="account-avatar" aria-label="Sample account">CF</span></header>
      {message && <div className="account-notice" role="status"><Glyph name="check" size={18}/><span>{message}</span><button aria-label="Dismiss message" onClick={()=>setMessage('')}>×</button></div>}
      {screen === 'coin' && <>
        {activated && <button className="back-link" onClick={()=>go('account')}><Glyph name="back" size={18}/> Your account</button>}
        <section className="coin-overview"><div className="eyebrow">CASHFLOWKEY <span className="verified"><Glyph name="check" size={11}/></span></div><h1>Your CFK.<br/>Your next move.</h1><p>Buy, hold, or sell. All in one place.</p>
          <div className="preview-position"><span>Your sample CFK position</span><strong>$250.00</strong></div>
          <svg className="preview-chart" viewBox="0 0 420 120" role="img" aria-label="Illustrative price chart, not market data"><path d="M0 90 20 93 40 75 65 83 90 57 120 65 140 40 160 70 190 62 210 44 240 55 270 32 300 38 330 12 355 25 380 9 420 16" fill="none" stroke="#1683f8" strokeWidth="3"/><path d="M0 110H420" stroke="#edf0f4"/></svg>
        </section>
        <section className="action-panel"><span className="eyebrow">CHOOSE YOUR AMOUNT</span><div className="amount-pills">{['20','50','100'].map(value=><button key={value} aria-pressed={amount===value} onClick={()=>setAmount(value)}>${value}</button>)}</div><div className="two-actions"><button className="button-secondary" onClick={()=>go('sell')}>Sell</button><button className="button-primary" onClick={()=>setMessage('Design preview: your existing Buy CFK checkout stays here.')}>Buy CFK <Glyph name="plus" size={18}/></button></div></section>
      </>}
      {screen === 'sell' && <>
        <button className="back-link" onClick={()=>go(activated?'account':'coin')}><Glyph name="back" size={18}/> Back</button>
        <div className="page-intro"><span className="eyebrow">SELL & SPEND</span><h1>From CFK.<br/>To everyday life.</h1><p>Sell your CFK into USDC you can spend with your CFK card.</p></div>
        <section className="sale-amount"><label htmlFor="sale-amount">How much would you like to sell?</label><div><span>$</span><input id="sale-amount" inputMode="decimal" value={amount} aria-invalid={!valid} onChange={e=>{if(/^\d{0,6}(\.\d{0,2})?$/.test(e.target.value))setAmount(e.target.value);}}/></div><span>Sample CFK value: $250.00 <button onClick={()=>setAmount('250')}>Sell all</button></span></section>
        <div className="destination"><div className="mini-card"><Glyph name="card"/></div><div><strong>Your CFK card</strong><span>{activated?'Use your existing card':'A virtual card for everyday spending'}</span></div><Glyph name="check" size={18}/></div>
        <dl className="sale-breakdown"><div><dt>CFK sale amount</dt><dd>{valid?money(gross):'—'}</dd></div><div><dt>Platform fee <span>15%</span></dt><dd>{quote?'−'+money(Number(quote.fee)/1e6):'—'}</dd></div><div className="sale-total"><dt>Estimated card balance added</dt><dd>{quote?money(net):'—'}</dd></div></dl>
        <p className="fine-print align-left">Preview estimate before trading costs. Your final quote will show the amount received. Funds are spendable after conversion confirms.</p>
        {!activated && <p className="setup-note"><Glyph name="lock" size={18}/> One-time identity verification and card approval come before your first card conversion.</p>}
        <button className="button-primary full" disabled={!valid} onClick={()=>activated?completeSale():go('setup')}>{activated?'Preview sale to card':'Continue to CFK card'}<Glyph name="arrow" size={18}/></button>
      </>}
      {screen === 'setup' && <><button className="back-link" onClick={()=>go('sell')}><Glyph name="back" size={18}/> Back to sale</button><div className="page-intro"><span className="eyebrow">YOUR EVERYDAY CARD</span><h1>Meet your CFK card.</h1><p>Your balance. Ready when you are.</p></div><CardArt/><div className="feature-list"><div><Glyph name="wallet"/><span>Add to Apple Pay or Google Pay where supported.</span></div><div><Glyph name="lock"/><span>Manage your card, statements, and transactions in one place.</span></div></div><p className="setup-note">In the live flow, Privy handles identity verification, disclosures, and card approval here. This preview skips those steps and creates no card.</p><button className="button-primary full" onClick={completeSale}>Preview the funded account<Glyph name="arrow" size={18}/></button></>}
      {screen === 'account' && <>
        <section className="balance-hero"><div className="balance-label"><span>Available to spend</span><span className="balance-currency">USD</span></div><h1>{money(balance)}</h1><p>Held in USDC · Sample card balance</p><div className="balance-actions"><button onClick={()=>go('rebuy')}><Glyph name="plus" size={18}/> Buy more CFK</button><button onClick={()=>go('sell')}>Sell CFK <Glyph name="arrow" size={18}/></button></div></section>
        <div className="account-tabs" role="tablist" aria-label="Account views">{[['home','Overview'],['card','My card'],['activity','Activity']].map(([key,label])=><button key={key} role="tab" id={'tab-'+key} aria-selected={tab===key} aria-controls="account-content" onClick={()=>setTab(key)}>{label}</button>)}</div>
        <section id="account-content" role="tabpanel" aria-labelledby={'tab-'+tab}>
          {tab!=='activity' && <><div className="section-title"><h2>Your CFK card</h2><span className={frozen?'status-pill paused':'status-pill'}>{frozen?'Frozen':'Active'}</span></div><CardArt frozen={frozen}/>
            <div className="card-actions"><button onClick={()=>setMessage('Preview only. Secure card details will open inside Privy.')}><Glyph name="card"/><span>Card details</span></button><button onClick={()=>setFrozen(!frozen)}><Glyph name="snow"/><span>{frozen?'Unfreeze':'Freeze card'}</span></button><button onClick={()=>setMessage('Preview only. Wallet provisioning will use Privy’s supported Apple Pay / Google Pay flow.')}><Glyph name="wallet"/><span>Add to wallet</span></button></div>
            {tab==='card'&&<button className="support-link" onClick={()=>setMessage('Preview only. Privy provides card statements, replacement, and managed support.')}>Statements & card support <Glyph name="arrow" size={17}/></button>}</>}
          {tab!=='card' && <><div className="section-title"><h2>Recent activity</h2><span>Sample</span></div><div className="transaction-row"><span className="transaction-icon"><Glyph name="arrow"/></span><div><strong>CFK sold to card</strong><span>USDC · Example transaction</span></div><div className="transaction-amount"><strong>+{money(balance)}</strong><span>Completed</span></div></div><div className="quiet-note">Card purchases and CFK trades will appear here.</div></>}
        </section>
      </>}
      {screen==='rebuy'&&<><button className="back-link" onClick={()=>go('account')}><Glyph name="back" size={18}/> Your account</button><div className="page-intro"><span className="eyebrow">KEEP IT SIMPLE</span><h1>Back into CFK.</h1><p>Buy directly from your available USDC balance.</p></div><div className="funding-source"><Glyph name="wallet"/><div><strong>CFK account balance</strong><span>{money(balance)} available in this preview</span></div><Glyph name="check" size={18}/></div><p className="setup-note">The live flow will quote the conversion and applicable fees before you confirm. No new card checkout is needed.</p><button className="button-primary full" onClick={()=>setMessage('Design preview only. Buying from USDC requires the conversion integration; no trade was placed.')}>Preview buying from balance<Glyph name="arrow" size={18}/></button></>}
      <footer className="account-footer"><Glyph name="lock" size={13}/><span>Free Crypto App LLC · Crypto can lose value.</span></footer>
    </main>
    {activated&&<nav className="bottom-navigation" aria-label="Main navigation"><button aria-current={screen==='account'?'page':undefined} onClick={()=>{setTab('home');go('account');}}><Glyph name="home"/><span>Account</span></button><button aria-current={screen==='coin'?'page':undefined} onClick={()=>go('coin')}><Glyph name="chart"/><span>CFK</span></button><button onClick={()=>{setTab('card');go('account');}}><Glyph name="card"/><span>Card</span></button></nav>}
  </>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
