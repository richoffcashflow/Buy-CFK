import React from 'react';

export function AccountIcon({name}) {
  const paths = {
    coin: 'm3 17 5-5 4 2 9-10',
    card: 'M3 8h18M5 16h4M4 4h16a1 1 0 0 1 1 1v14H3V5a1 1 0 0 1 1-1Z',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z',
    user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 22v-3a8 8 0 0 1 16 0v3',
    wallet: 'M3 7h18v14H3V4h15v3M16 12h5v5h-5Z',
    history: 'M3 11a9 9 0 1 1 2 7M3 5v6h6M12 7v6l4 2'
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.card}/></svg>;
}

export function AccountNavigation({tab, onChange, saleCompleted, disabled}) {
  return <nav className="account-navigation" aria-label="Main navigation">
    <button type="button" aria-current={tab === 'cfk' ? 'page' : undefined} disabled={disabled} onClick={() => onChange('cfk')}><AccountIcon name="coin"/><span>CFK</span></button>
    <button type="button" aria-current={tab === 'card' ? 'page' : undefined} disabled={disabled} aria-label={saleCompleted ? 'CFK Card' : 'CFK Card, locked preview'} onClick={() => onChange('card')}><span className="nav-card-icon"><AccountIcon name="card"/>{!saleCompleted && <span className="nav-lock"><AccountIcon name="lock"/></span>}</span><span>CFK Card</span></button>
  </nav>;
}

export default function CashCardPreview({saleCompleted, name, canSell, onSell, onBack, history, historyError, onRefresh, busy}) {
  return <section className="cash-card-page" aria-labelledby="cash-card-title">
    <div className="cash-card-heading"><div><span className="account-eyebrow">YOUR EVERYDAY CARD</span><h2 id="cash-card-title">Meet CFK Card.</h2></div><span className="card-state"><AccountIcon name="lock"/>{saleCompleted ? 'Not activated' : 'Locked'}</span></div>
    <p className="cash-card-intro">Your next step from CFK to everyday spending.</p>
    <div className="cash-card-art" role="img" aria-label="CFK Card design preview, not activated">
      <div className="cash-card-art-top"><span>CASHFLOWKEY</span><img src="/assets/cashflow-user-logo.png" alt="" width="52" height="52"/></div>
      <div className="cash-card-chip" aria-hidden="true"><i/><i/><i/></div>
      <div className="cash-card-digits" aria-hidden="true">•••• <span>••••</span> <span>••••</span> ••••</div>
      <div className="cash-card-art-bottom"><span>{name || 'YOUR NAME'}</span><span>CFK CARD</span></div>
    </div>
    <div className="card-unlock"><span className="card-unlock-icon"><AccountIcon name="lock"/></span><div><h3>{saleCompleted ? 'Your first sale is complete' : 'Unlock after your first sale'}</h3><p>{saleCompleted ? 'CFK Card activation is being connected. Your sale proceeds remain in SOL until a card conversion is available.' : 'Once you sell CFK, the next step is setting up CFK Card. Card activation is not available yet.'}</p></div></div>
    {saleCompleted ? <button className="primary" disabled>Activation coming soon</button> : <button className="primary" disabled={busy} onClick={canSell ? onSell : onBack}>{canSell ? 'Sell CFK' : 'Back to CFK'}</button>}
    <div className="card-benefits"><h3>Once your card is activated</h3><div><AccountIcon name="wallet"/><p>Add to Apple Pay or Google Pay where supported.</p></div><div><AccountIcon name="card"/><p>View your spending balance and manage your card in one place.</p></div><div><AccountIcon name="history"/><p>Keep track of transactions, statements, and card support.</p></div></div>
    {saleCompleted && <section className="card-coin-history" aria-label="Your coin transactions"><div className="section-heading"><h3>Your coin transactions</h3><span>CFK</span></div>{historyError ? <p>Transactions could not load. <button onClick={onRefresh}>Retry</button></p> : <ul>{(history || []).filter(item=>item.kind==='trade').slice(0,5).map(item=><li key={item.id}><div><strong>{item.action==='sell'?'CFK sold':'CFK bought'}</strong><span>{new Date(item.createdAt).toLocaleDateString()} · {item.status.replaceAll('_',' ')}</span></div><strong>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(item.amountCents/100)}</strong></li>)}</ul>}</section>}
  </section>;
}
