import React,{lazy,Suspense,useCallback,useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api,formatMoney,formatNumber} from './utils.js';
import {captureAttribution,getSession,track,setConsent,getConsent} from './tracking.js';
import Legal from './Legal.jsx';
import InstallApp from './InstallApp.jsx';
import PriceChart from './PriceChart.jsx';
import TradeDock from './TradeDock.jsx';
import StripeCheckout from './StripeCheckout.jsx';
import {walletForAction} from './wallet-lifecycle.js';
import {readPending as loadPending,pendingTrade,savedAmount} from './pending-state.js';
import {PURCHASE_INTENT_KEY,readPurchaseIntent,validAmount} from './purchase-intent.js';
const loadWallet=()=>import('./Wallet.jsx');
const Wallet=lazy(loadWallet);
const warmWallet=()=>{loadWallet().catch(()=>{});};
const MINT='3Rcko4DWwbLQP6vZ2Juxy3gDbv3omNkeg5np17fbpump';
const CREATOR_SOCIALS=[
  {name:'Instagram',icon:'instagram',url:'https://www.instagram.com/cashflowkeyy/'}
];
const remember={get:k=>{try{return sessionStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{sessionStorage.setItem(k,v);}catch{}},remove:k=>{try{sessionStorage.removeItem(k);}catch{}}};
const durable={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}},remove:k=>{try{localStorage.removeItem(k);}catch{}}};
const PENDING_LIFETIME=24*60*60*1000;
const readPending=()=>loadPending([remember,durable]);
function Icon({name='arrow'}){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={name==='plus'?'M12 5v14M5 12h14':name==='close'?'m6 6 12 12M6 18 18 6':name==='check'?'m5 12 4 4L19 6':'M7 17 17 7M7 7h10v10'}/></svg>;}
function Modal({title,children,onClose}){
  const ref=useRef(null),titleId=useId();
  useEffect(()=>{
    const previous=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    if(!ref.current.contains(document.activeElement))ref.current.focus();
    return()=>{document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
  },[]);
  function keydown(event){
    if(event.key==='Escape'){event.stopPropagation();onClose();return;}
    if(event.key!=='Tab')return;
    const items=[...ref.current.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')];
    if(!items.length){event.preventDefault();return;}
    const index=items.indexOf(document.activeElement);
    if(event.shiftKey&&(index<=0)){event.preventDefault();items.at(-1).focus();}
    else if(!event.shiftKey&&(index===items.length-1||index<0)){event.preventDefault();items[0].focus();}
  }
  return createPortal(<div className="dialog-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} onKeyDown={keydown}><div className="dialog-head"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close"/></button></div>{children}</section></div>,document.body);
}
export default function App(){
  const [config,setConfig]=useState(null),[market,setMarket]=useState(null),[points,setPoints]=useState([]),[activity,setActivity]=useState(null);
  const [inspected,setInspected]=useState(null),[chartLoading,setChartLoading]=useState(true),[historyStart,setHistoryStart]=useState(null),[loginMethod,setLoginMethod]=useState('email');
  const [range,setRange]=useState('1d'),[amount,setAmount]=useState(()=>{const action=readPurchaseIntent(remember);return action?String(action.amountUsd):savedAmount(durable);}),[position,setPosition]=useState(null),[notice,setNotice]=useState(''),[configError,setConfigError]=useState(false),[marketError,setMarketError]=useState(false),[isGuest,setIsGuest]=useState(false),[needsEmail,setNeedsEmail]=useState(false);
  const [modal,setModal]=useState(null),[flow,setFlow]=useState({step:'idle'}),[intent,setIntent]=useState(()=>{const p=readPending();return p?.direction==='offramp'?'withdraw':p?.side==='sell'?'sell':'buy';});
  const [consent,setConsentState]=useState(getConsent()),[chartMessage,setChartMessage]=useState('Loading price history…');
  // Restore an existing session quietly. A saved amount or payment never opens
  // checkout or creates a guest automatically after a refresh.
  const [walletActive,setWalletActive]=useState(()=>durable.get('cfk_account_seen')==='1');
  const [activation,setActivation]=useState(0),[account,setAccount]=useState(null),[busy,setBusy]=useState(false),[history,setHistory]=useState(null),[historyError,setHistoryError]=useState(false),[online,setOnline]=useState(()=>navigator.onLine!==false);
  const bridgeRef=useRef(null),lock=useRef(false),queuedAction=useRef(null),recoverRequested=useRef(false),pendingRef=useRef(readPending());
  const savePending=data=>{
    const saved=data?{...data,userId:bridgeRef.current?.userId,savedAt:Date.now()}:null;
    pendingRef.current=saved;
    if(saved){const value=JSON.stringify(saved);remember.set('cfk_pending',value);durable.set('cfk_pending',value);}
    else {remember.remove('cfk_pending');durable.remove('cfk_pending');remember.remove('cfk_payment_attempt');durable.remove('cfk_payment_attempt');}
  };
  const setLock=value=>{lock.current=value;setBusy(value);};
  const refreshHistory=useCallback(async()=>{const b=bridgeRef.current;if(!b)return;try{const result=await api('/account/history',{token:await b.getAccessToken()});if(bridgeRef.current?.userId===b.userId){setHistory(result.items||[]);setHistoryError(false);}}catch{setHistoryError(true);}},[]);
  const refreshPosition=useCallback(async()=>{const b=bridgeRef.current;if(!b)return null;if(!b.address){setPosition({valueUsd:0,tokens:0,availableUsd:0});return null;}try{const next=await api('/position?wallet='+b.address);if(bridgeRef.current?.userId!==b.userId)return null;setPosition(next);if(next.tokens>0)setFlow(current=>current.step==='complete'&&current.side==='buy'&&!current.positionUpdated?{...current,positionUpdated:true}:current);return next;}catch{return null;}},[]);
  useEffect(()=>{if(validAmount(amount))durable.set('cfk_amount',amount);},[amount]);
  const refreshConfig=useCallback(async()=>{setConfigError(false);try{const c=await api('/config');setConfig(c);getSession().then(()=>track('ViewContent',{trigger:'coin_page'},c)).catch(()=>{});}catch{setConfigError(true);}},[]);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine!==false);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{
    captureAttribution();refreshConfig();
  },[refreshConfig]);
  useEffect(()=>{
    let alive=true;const refresh=()=>{api('/market').then(d=>{if(alive){setMarket(d);setMarketError(false);}}).catch(()=>{if(alive)setMarketError(true);});api('/activity').then(d=>{if(alive)setActivity(d);}).catch(()=>{if(alive)setActivity({items:[],unavailable:true});});};
    refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},30000);return()=>{alive=false;clearInterval(timer);};
  },[]);
  useEffect(()=>{
    let alive=true;setPoints([]);setChartLoading(true);setHistoryStart(null);setInspected(null);setChartMessage('Loading price history…');const refresh=()=>api('/chart?range='+range).then(d=>{if(alive){setPoints(d.points||[]);setHistoryStart(d.buildingHistory||range==='all'?d.historyStart:null);setChartLoading(false);setChartMessage(d.buildingHistory?'Building price history':'Price history is unavailable right now.');}}).catch(()=>{if(alive){setChartLoading(false);setChartMessage('Price history is unavailable right now.');}});
    refresh();const t=setInterval(()=>{if(!document.hidden)refresh();},60000);return()=>{alive=false;clearInterval(t);};
  },[range]);
  useEffect(()=>{refreshHistory();},[account,refreshHistory]);
  useEffect(()=>{refreshPosition();const t=setInterval(()=>{if(!document.hidden)refreshPosition();},20000);return()=>clearInterval(t);},[account,refreshPosition]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(t);},[notice]);
  const onReady=useCallback(bridge=>{durable.set('cfk_account_seen','1');const previous=bridgeRef.current;if(previous?.userId!==bridge.userId){setHistory(null);setPosition(null);}bridgeRef.current=bridge;setIsGuest(Boolean(bridge.isGuest));setNeedsEmail(Boolean(bridge.needsEmail));if(pendingRef.current?.userId&&pendingRef.current.userId!==bridge.userId){savePending(null);setFlow({step:'idle'});setModal(null);}setAccount(bridge.userId);if(previous&&previous.address!==bridge.address)refreshPosition();},[refreshPosition]);
  const onError=useCallback(message=>{setFlow({step:'auth-error',message});setModal('transaction');},[]);
  const onCancelSignIn=useCallback(()=>{queuedAction.current=null;recoverRequested.current=false;remember.remove(PURCHASE_INTENT_KEY);setFlow({step:'idle'});setModal(null);setWalletActive(Boolean(bridgeRef.current));},[]);
  function signIn(method='email'){setLoginMethod(method);setModal(method==='guest'?'transaction':null);setFlow({step:method==='guest'?'guest-connect':'sign-in'});setWalletActive(true);setActivation(n=>n+1);}
  function begin(side,override){
    if(lock.current||queuedAction.current)return;
    if(!online){setNotice('You’re offline. Reconnect before buying, selling, or checking a payment.');return;}
    setIntent(side);
    setModal('transaction');
    if(pendingRef.current){recover();return;}
    const selected=override??Number(amount);
    if(!validAmount(String(selected))){setFlow({step:'blocked',message:'Choose an amount between $0.01 and $1,000,000, with no more than two decimal places.'});return;}
    if(side==='sell'&&position&&!(position.tokens>0)){setFlow({step:'blocked',message:'You do not have any CFK to sell yet. Buy CFK first, then you can sell it here.'});return;}
    if(!config?.privyAppId){setFlow({step:'blocked',message:'Buying and selling are being connected. No payment has been taken.'});return;}
    if(side==='buy'&&config.checkout?.buyEnabled!==true){setFlow({step:'blocked',message:'Buying is temporarily unavailable. No payment has been taken. You can still sign in to check your position or an earlier payment.'});return;}
    if(side==='withdraw'&&config.checkout?.withdrawEnabled!==true){setFlow({step:'blocked',message:'Cash withdrawals are not available yet. Sale proceeds remain in your account as SOL, whose dollar value can change.'});return;}
    if(side==='buy')track('AddToCart',{trigger:'buy_pressed'},config).catch(()=>{});
    queuedAction.current={side,amountUsd:selected};
    if(!bridgeRef.current){
      if(side==='buy'){
        if(config.guestCheckoutEnabled!==true){queuedAction.current=null;setFlow({step:'blocked',message:'Guest checkout is not available yet. No payment has been taken.'});return;}
        remember.set(PURCHASE_INTENT_KEY,JSON.stringify({...queuedAction.current,savedAt:Date.now()}));signIn('guest');
      }else signIn();
      return;
    }
    setFlow({step:'idle'});
    if(bridgeRef.current){const action=queuedAction.current;queuedAction.current=null;prepare(action);}
  }
  async function prepare(action){
    remember.remove(PURCHASE_INTENT_KEY);
    if(!online){setNotice('Reconnect before continuing. Your payment reference is saved.');return;}
    if(lock.current||!bridgeRef.current)return;setLock(true);setModal('transaction');setFlow({step:'loading'});
    try{
      const b=bridgeRef.current;
      const [token,session]=await Promise.all([b.getAccessToken(),getSession()]);
      if(!token)throw new Error('Your account is reconnecting. Please try again.');
      // Validate server auth and payment readiness before creating a funding address.
      if(action.side==='buy')await api('/ramp/preflight',{method:'POST',token,body:{grossCents:Math.round(action.amountUsd*100)}});
      const address=await walletForAction(b,action.side,config.checkout);
      if(action.side==='buy'||action.side==='withdraw'){
        const direction=action.side==='buy'?'onramp':'offramp';
        let attempt;try{attempt=JSON.parse(remember.get('cfk_payment_attempt')||durable.get('cfk_payment_attempt')||'null');}catch{}
        if(!attempt||!attempt.savedAt||Date.now()-attempt.savedAt>PENDING_LIFETIME||attempt.amountUsd!==action.amountUsd||attempt.wallet!==address||attempt.direction!==direction){attempt={id:crypto.randomUUID(),amountUsd:action.amountUsd,wallet:address,direction,savedAt:Date.now()};const value=JSON.stringify(attempt);remember.set('cfk_payment_attempt',value);durable.set('cfk_payment_attempt',value);}
        const data=await api('/ramp/session',{method:'POST',token,body:{wallet:address,direction,grossCents:Math.round(action.amountUsd*100),sessionId:session.id,checkoutId:attempt.id,intent:action.side}});
        if(data.existingPayment){savePending({type:'payment',direction,provider:data.provider,rampId:data.rampId,checkoutId:attempt.id});setFlow({step:'pending',message:'Checking your existing payment…'});}
        else startPayment({direction,...data,checkoutId:attempt.id});
      }else{
        const data=await api('/trade/prepare',{method:'POST',token,body:{wallet:address,side:'sell',amountUsd:action.amountUsd,sessionId:session.id}});
        setFlow({step:'sell-review',quote:data,amountUsd:action.amountUsd});
      }
    }catch(e){setFlow({step:'blocked',message:e.message});}finally{setLock(false);}
  }
  async function execute(quote,side){
    if(quote.existingOrder){savePending(pendingTrade(quote,pendingRef.current,side));return confirmPending(pendingRef.current);}
    setFlow({step:'buying',side});
    const transaction=await bridgeRef.current.sign(quote.transaction);
    const pending=pendingTrade(quote,pendingRef.current,side,transaction);
    savePending(pending);return confirmPending(pending);
  }
  async function confirmPending(pending){
    const token=await bridgeRef.current.getAccessToken();setFlow({step:'confirming',side:pending.side});
    if(pending.transaction){const submitted=await api('/trade/submit',{method:'POST',token,body:{orderId:pending.orderId,transaction:pending.transaction}});pending={...pending,signature:submitted.signature};savePending(pending);}
    let result;
    for(let i=0;i<12;i++){result=await api('/trade/confirm',{method:'POST',token,body:{orderId:pending.orderId}});if(result.confirmed)break;await new Promise(resolve=>setTimeout(resolve,1500));}
    if(!result?.confirmed){setFlow({step:'pending',message:'Your transaction is still confirming. We will keep checking it.'});return;}
    savePending(null);refreshHistory();if(result.event)track('Purchase',result.event,config,{verified:true}).catch(()=>{});
    const updated=await refreshPosition();setFlow({step:'complete',side:result.side,signature:result.signature,positionUpdated:result.side==='buy'&&updated?.tokens>0});
  }
  async function buyFunded(pending){
    const b=bridgeRef.current,token=await b.getAccessToken(),session=await getSession();setFlow({step:'buying',side:'buy'});
    const quote=await api('/trade/prepare',{method:'POST',token,body:{wallet:b.address,side:'buy',fundingId:pending.rampId,sessionId:session.id}});
    await execute(quote,'buy');
  }
  async function resume(){
    const pending=pendingRef.current;if(!pending||lock.current||!online)return;if(!bridgeRef.current){signIn();return;}setLock(true);
    try{
      if(pending.type==='trade'){await confirmPending(pending);return;}
      const result=await api('/ramp/status?id='+pending.rampId,{token:await bridgeRef.current.getAccessToken()});
      if(result.status==='failed'){savePending(null);throw new Error('The payment did not complete.');}
      if(result.status==='review_required'){setFlow({step:'funding-review',...result});return;}
      if(result.status==='sandbox_complete'){savePending(null);setFlow({step:'sandbox-complete'});return;}
      if(result.status!=='completed'){setFlow({step:'checkout',...pending,...result});if(result.direction==='onramp'&&pending.checkoutId&&(pending.checkoutUrl||result.clientSecret))track('InitiateCheckout',{trigger:'payment_ready',checkoutId:pending.checkoutId},config).catch(()=>{});return;}
      if(result.direction==='offramp'){savePending(null);refreshHistory();setFlow({step:'paid'});await refreshPosition();return;}
      savePending({...pending,type:'funded'});await buyFunded(pending);
    }catch(e){
      const p=pendingRef.current; // A conflict is not evidence that an earlier payment can be forgotten.
      setFlow({step:p?.type==='funded'?'funded-error':'blocked',message:e.message});await refreshPosition();
    }finally{setLock(false);}
  }
  useEffect(()=>{
    if(!account||!config)return;
    if(queuedAction.current){const action=queuedAction.current;queuedAction.current=null;prepare(action);}
    else if(pendingRef.current&&recoverRequested.current){recoverRequested.current=false;setModal('transaction');resume();}
    else {setFlow({step:'idle'});setModal(null);}
  },[account,config]);
  useEffect(()=>{if(!account||!online||modal!=='transaction'||!['checkout','pending'].includes(flow.step))return;const t=setInterval(()=>resume(),5000);return()=>clearInterval(t);},[account,flow.step,online,modal]);
  function startPayment(payment){const pending={type:'payment',provider:payment.provider,providerName:payment.providerName,direction:payment.direction,rampId:payment.rampId,checkoutId:payment.checkoutId,checkoutUrl:payment.checkoutUrl,grossCents:payment.grossCents,platformFeeCents:payment.platformFeeCents,providerFeeCents:payment.providerFeeCents,netCents:payment.netCents};savePending(pending);setFlow({...payment,...pending,step:'checkout'});if(payment.direction==='onramp')track('InitiateCheckout',{trigger:'payment_ready',checkoutId:payment.checkoutId},config).catch(()=>{});}
  async function confirmSale(){
    if(lock.current||!online||flow.step!=='sell-review')return;
    if(flow.quote.expiresAt&&new Date(flow.quote.expiresAt)<=new Date()){await prepare({side:'sell',amountUsd:flow.amountUsd});return;}
    setLock(true);
    try{await execute(flow.quote,'sell');}catch(e){setFlow({step:'blocked',message:e.message});}finally{setLock(false);}
  }
  function recoverHistory(item){
    if(lock.current)return;
    savePending(item.kind==='payment'?{type:'payment',rampId:item.id,direction:item.action}:{type:'trade',orderId:item.id,side:item.action,signature:item.signature,...(item.rampId?{rampId:item.rampId}:{})});
    recover();
  }
  function recover(){setIntent(pendingRef.current?.direction==='offramp'?'withdraw':pendingRef.current?.side||'buy');if(!bridgeRef.current){recoverRequested.current=true;signIn();return;}setModal('transaction');resume();}
  async function approveFunding(){
    if(lock.current||!online)return;setLock(true);
    try{const result=await api('/ramp/approve',{method:'POST',token:await bridgeRef.current.getAccessToken(),body:{rampId:flow.rampId,reviewToken:flow.reviewToken}});
      if(result.status==='review_required'){setFlow({step:'funding-review',...result});return;}
      setFlow({step:'pending',message:'Your payment is verified. Preparing your CFK purchase…'});
    }catch(e){setFlow({step:'blocked',message:e.message});}finally{setLock(false);}
  }
  function chooseConsent(value){setConsent(value);setConsentState(getConsent());track('ViewContent',{trigger:'coin_page'},config).catch(()=>{});if(modal==='measurement')setModal(null);}
  async function copyMint(){try{await navigator.clipboard.writeText(config?.mint||MINT);setNotice('Token address copied.');}catch{setNotice('Select the address to copy it.');}}
  const close=()=>{if(lock.current)return;queuedAction.current=null;recoverRequested.current=false;remember.remove(PURCHASE_INTENT_KEY);setModal(null);};
  const saveAccount=()=>{setLoginMethod('upgrade');setModal(null);bridgeRef.current?.upgrade?.();};
  const change=market?.change24h,changeText=change!=null?(change>=0?'+':'')+change.toFixed(2)+'%':'—';
  return <>
    <main className="app">
      {!online&&<p className="connection-notice" role="status">You’re offline. Displayed prices may be out of date. Reconnect to use your account.</p>}
      {configError&&<div className="connection-notice" role="status">Checkout could not connect. <button onClick={refreshConfig}>Retry connection</button></div>}
      <header className="coin-identity">
        <div className="coin-identity-main"><img src="/assets/cashflow-emblem-192.png" width="48" height="48" alt="Cashflow"/><div><h1>CASHFLOWKEY</h1><span className="coin-symbol">$CFK<span className="official-badge" role="img" aria-label="Official CFK token" title="Official Cashflowkey token"><Icon name="check"/></span></span></div></div>
        <p className="brand-tagline">Buy, sell &amp; track your CFK.</p>
        <button type="button" className="token-address-link" onClick={()=>setModal('token')}>Token details</button>
      </header>
      <section className="coin-card" aria-label="Cashflowkey market">
        <div className="price-heading"><h2>$CFK Price</h2><span className="price-currency">USD</span></div>
        <div className="price-row"><strong>{formatMoney(inspected?.[4]??market?.priceUsd,true)}</strong><div className="price-detail">{inspected?<span className="inspected-time">{new Date(inspected[0]*1000).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}<small>Historical price</small></span>:<span className={change==null?'change muted':change<0?'change loss':'change gain'}>{changeText}<small>past 24 hours</small></span>}</div></div>
        {marketError&&<p className="market-warning" role="status">Price updates are reconnecting. The displayed price may be out of date.</p>}
        <PriceChart key={range} points={points} message={chartMessage} loading={chartLoading} historyStart={historyStart} onInspect={setInspected}/>
        <div className="ranges" role="group" aria-label="Chart period">{[['1h','1H'],['1d','1D'],['1w','1W'],['1m','1M'],['all','ALL']].map(([key,label])=><button key={key} aria-pressed={range===key} onClick={()=>setRange(key)}>{label}</button>)}</div>
      </section>
      <section id="position" className="position-card" aria-label="Your position"><div className="position-heading"><h2>Your Position</h2><span className="token-badge">$CFK</span></div><div className="position-value"><div><span>CFK value</span><strong>{account?formatMoney(position?.valueUsd):'—'}</strong></div>{position?.pnlPercent!=null&&<div className="position-return"><strong className={position.pnlPercent<0?'loss':'gain'}>{position.pnlPercent>=0?'+':''}{position.pnlPercent.toFixed(2)}%</strong><small>{formatMoney(position.pnlUsd)} return</small></div>}</div><div className="position-tokens"><div><span>Tokens owned</span><strong>{formatNumber(account?position?.tokens:null)}</strong></div><span className="token-badge">$CFK</span></div>
        {!account&&<div className="account-status"><p>Already bought CFK? Sign in to see your balance.</p><button className="secondary" disabled={!config?.privyAppId||flow.step==='sign-in'} onClick={()=>{queuedAction.current=null;signIn();}}>Sign in to your account</button><p><a href="mailto:support@freecryptoapp.com">Need help accessing an older account?</a></p></div>}
        {(isGuest||needsEmail)&&(position?.tokens>0||position?.availableUsd>0||pendingRef.current?.type==='funded')&&<div className="save-account"><h3>Save your account</h3><p>Add your email to keep access to your CFK on any device.{isGuest?' Until then, access is limited to this browser and expires after 30 days.':''}</p><button className="primary" disabled={busy||!online} onClick={saveAccount}>Save with email</button></div>}
        {flow.step==='sign-in'&&<div className="account-status"><p role="status">Complete secure sign-in to continue.</p><button className="secondary" onClick={onCancelSignIn}>Cancel sign-in</button></div>}
        {account&&position?.availableUsd!=null&&<div className="account-status"><div className="available-balance"><span>Available balance</span><strong>{formatMoney(position.availableUsd)}</strong></div><p>Held in SOL, shown in USD. Its value can change. A reserve is kept for network costs.</p>{config?.checkout?.withdrawEnabled?<button className="secondary" disabled={busy||!online||position.availableUsd<.01} onClick={()=>begin('withdraw',Math.floor(position.availableUsd*100)/100)}>Withdraw cash</button>:<p className="availability-note">Cash withdrawals are not available yet. Selling CFK keeps the proceeds in your account as SOL.</p>}</div>}
        {pendingRef.current&&<div className="account-status"><p>You have an unfinished payment or trade.</p><button className="secondary" disabled={busy||flow.step==='sign-in'} onClick={recover}>Check previous payment or trade</button></div>}
        {account&&<details className="account-history"><summary>Recent account activity</summary>{historyError?<p>Activity could not load. <button type="button" onClick={refreshHistory}>Try again</button></p>:history===null?<p role="status">Loading your activity…</p>:history.length?<ul>{history.map(item=><li key={item.kind+item.id}><div><strong>{item.kind==='payment'?(item.action==='onramp'?'Payment':'Withdrawal'):(item.action==='buy'?'CFK purchase':'CFK sale')} · {formatMoney(item.amountCents/100)}</strong><span>{item.status==='prepared'?'Not submitted':item.status.replaceAll('_',' ')} · {new Date(item.createdAt).toLocaleDateString()}</span><small>Reference: {item.id}</small></div>{item.recoverable&&<button className="history-review" disabled={busy||!online} onClick={()=>recoverHistory(item)}>Review</button>}</li>)}</ul>:<p>No payments or trades yet.</p>}<p className="history-note">Payments and coin trades are separate steps. Up to 20 recent records are shown.</p></details>}
      </section>
      <section className="market-card" aria-label="24 hour market"><h2>24h market</h2><dl className="market-stats"><div><dt>Market cap</dt><dd>{formatMoney(market?.marketCap,true,true)}</dd></div><div><dt>24h volume</dt><dd>{formatMoney(market?.volume24h,true,true)}</dd></div><div><dt>Holders</dt><dd>{formatNumber(market?.holders)}</dd></div><div><dt>24h change</dt><dd className={change==null?'muted':change<0?'loss':'gain'}>{changeText}</dd></div></dl></section>
      <section className="activity" aria-label="Coin activity"><div className="section-heading"><h2>Coin Activity</h2><span className="activity-badge">Latest trades</span></div><div className="activity-status"><span className={activity?.unavailable?'status-dot offline':'status-dot'}/><span>{activity?.unavailable?'Reconnecting to activity':'Recent buys & sells'}</span><small>{activity?.updatedAt?'Updated '+new Date(activity.updatedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Connecting…'}</small></div><ul>{activity?.items?.length?activity.items.slice(0,10).map(item=><li key={item.id}><span className={'activity-icon '+item.side}><Icon name={item.side==='buy'?'plus':'arrow'}/></span><div><strong>{item.side==='buy'?'Bought':'Sold'} CFK</strong><small>{new Date(item.timestamp).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small></div><div className="activity-value"><strong>{item.usd!=null?formatMoney(item.usd):formatNumber(item.tokens)+' CFK'}</strong></div><a href={'https://solscan.io/tx/'+item.signature} target="_blank" rel="noreferrer" aria-label="View transaction"><Icon/></a></li>):<li className="empty-activity"><p>{activity?.unavailable?'Activity is unavailable right now.':'Confirmed buys and sells will appear here.'}</p></li>}</ul><p className="source-note">Confirmed coin activity. Prices shown in USD when available.</p></section>
      <section className="creator-card" aria-labelledby="creator-heading">
        <div className="creator-photo"><img src="/assets/cashflowkey-creator.jpg" width="1152" height="2048" loading="lazy" decoding="async" alt="Cashflowkey seated in a vehicle with an orange interior"/><span className="creator-photo-label">THE NAME BEHIND $CFK</span></div>
        <div className="creator-body"><span className="brand-eyebrow">MEET THE CREATOR</span><h2 id="creator-heading">Cashflowkey</h2><p>Entrepreneur. Creator. Follow the person behind $CFK.</p><nav className="creator-socials" aria-label="Creator social profiles">{CREATOR_SOCIALS.map(social=><a key={social.name} href={social.url} target="_blank" rel="noopener noreferrer" aria-label={'Cashflowkey on '+social.name+' (opens in a new tab)'} title={social.name}><img src={'/assets/social-'+social.icon+'.svg'} width="19" height="19" alt=""/><span>{social.name}</span></a>)}</nav></div>
      </section>
      <footer><InstallApp/><p>Crypto can lose all its value. No returns are guaranteed.<br/>Free Crypto App LLC and related parties may hold or sell CFK.</p><nav aria-label="Legal"><button onClick={()=>setModal('disclosures')}>Disclosures</button><a href="/terms">Terms</a><a href="/privacy">Privacy</a><button onClick={()=>setModal('measurement')}>Privacy choices</button></nav><p>Operated by Free Crypto App LLC</p><a href="mailto:support@freecryptoapp.com">support@freecryptoapp.com</a></footer>
    </main>
    <TradeDock amount={amount} setAmount={setAmount} onBuy={()=>begin('buy')} onSell={()=>begin('sell',Math.min(Number(amount),Math.floor((position?.valueUsd||0)*100)/100))} busy={busy||!online} canSell={position?.tokens>0} openingSignIn={['sign-in','guest-connect'].includes(flow.step)} loading={!config&&!configError} unavailable={config?.checkout?.buyEnabled!==true} pending={pendingRef.current} onResume={recover} onWarm={warmWallet}/>
    {modal==='token'&&<Modal title="$CFK token details" onClose={()=>setModal(null)}><div className="token-details"><p>Official Cashflowkey token on Solana.</p><span>Token address</span><code>{config?.mint||MINT}</code><button className="primary" onClick={copyMint}>Copy address</button></div></Modal>}
    {walletActive&&config?.privyAppId&&<Suspense fallback={null}><Wallet appId={config.privyAppId} activation={activation} loginMethod={loginMethod} guestCheckoutEnabled={config.guestCheckoutEnabled} onReady={onReady} onError={onError} onCancel={onCancelSignIn}/></Suspense>}
    {notice&&<div className="toast" role="status">{notice}</div>}
    {modal==='transaction'&&<Modal title={intent==='withdraw'?'Withdraw cash':intent==='sell'?'Sell CFK':'Buy CFK'} onClose={close}>
      
      {flow.step==='auth-error'&&<div className="flow-state"><h3>Let’s reconnect your account</h3><p role="status">{flow.message}</p><button className="primary" onClick={()=>loginMethod==='upgrade'?saveAccount():signIn(loginMethod)}>Try again</button></div>}
      {['sign-in','guest-connect','idle','loading','buying','confirming'].includes(flow.step)&&<div className="flow-state"><div className="spinner"/><h3>{flow.step==='sign-in'?'Connecting your account':flow.step==='idle'?'Getting you ready':flow.step==='confirming'?'Confirming your transaction':flow.step==='buying'?(flow.side==='sell'?'Selling your CFK':'Buying your CFK'):'Preparing your amount'}</h3><p>{flow.step==='sign-in'?'Complete secure sign-in to continue.':flow.step==='idle'?'Preparing your account.':'You can follow the progress here.'}</p></div>}
      
      {flow.step==='checkout'&&<><div className="checkout-summary"><p className="dialog-copy"><strong>{flow.direction==='onramp'?'Pay '+formatMoney(flow.grossCents/100)+' to buy CFK':'Withdraw '+formatMoney(flow.grossCents/100)}</strong></p>{flow.platformFeeCents!=null&&<p className="dialog-copy">Includes our 15% fee ({formatMoney(flow.platformFeeCents/100)}){flow.providerFeeCents!=null?' and an estimated '+formatMoney(flow.providerFeeCents/100)+' payment provider fee.':'.'} {flow.direction==='onramp'?'Available for CFK and purchase costs: '+formatMoney(flow.netCents/100)+'. Coin purchase and network costs are extra.':'Estimated cash payout: '+formatMoney(flow.netCents/100)+'.'}</p>}</div>{flow.provider==='stripe'?(flow.clientSecret?<StripeCheckout publishableKey={flow.publishableKey} clientSecret={flow.clientSecret} onUpdate={resume}/>:<p role="status">Restoring your secure payment…</p>):(flow.checkoutUrl?<iframe className="checkout-frame" src={flow.checkoutUrl} title="Secure payment" allow="payment" referrerPolicy="no-referrer"/>:<p role="status">We’re checking the payment provider. Use Check payment to try again. Your payment reference is saved.</p>)}<p className="dialog-copy">{flow.direction==='onramp'?'Your CFK purchase starts automatically after your payment is verified.':'Your payout is confirmed by the payment provider.'}</p><button className="secondary" disabled={busy||!online} onClick={resume}>Check payment</button></>}
      {flow.step==='sell-review'&&<div className="review"><h3>Review sale</h3><dl><div><dt>Selected CFK value</dt><dd>{formatMoney(flow.amountUsd)}</dd></div><div><dt>Estimated sale proceeds</dt><dd>{formatMoney(flow.quote.amountUsd)}</dd></div><div><dt>CFK to sell</dt><dd>{formatNumber(flow.quote.tokens)}</dd></div><div><dt>Price movement allowance</dt><dd>{flow.quote.slippageBps/100}%</dd></div></dl><p>{config?.checkout?.withdrawEnabled?'Selling converts CFK to SOL. Withdrawing cash is a separate step with a 15% platform fee plus provider costs.':'Cash withdrawals are not available yet. Selling converts CFK to SOL held in your account; it does not pay cash to your bank.'}</p><p>Network and trading costs apply. Final proceeds may differ, and quotes can expire.</p><button className="primary" disabled={busy||!online} onClick={confirmSale}>Confirm sale</button><button className="secondary" onClick={close}>Cancel</button></div>}
      {flow.step==='funding-review'&&<div className="review"><h3>Your payment amount changed</h3><p>You paid {formatMoney(flow.grossCents/100)}. Review the updated amounts before buying CFK.</p><dl><div><dt>Platform fee · 15%</dt><dd>{formatMoney(flow.platformFeeCents/100)}</dd></div><div><dt>Payment provider fee</dt><dd>{formatMoney(flow.providerFeeCents/100)}</dd></div><div><dt>Available for CFK & extra costs</dt><dd>{formatMoney(flow.netCents/100)}</dd></div></dl><button className="primary" disabled={busy||!online} onClick={approveFunding}>Accept & buy CFK</button><button className="secondary" onClick={close}>Decide later</button></div>}
      {flow.step==='sandbox-complete'&&<div className="flow-state"><h3>Test payment complete</h3><p>No real money moved and no CFK was purchased.</p><button className="secondary" onClick={close}>Done</button></div>}
      {['blocked','funded-error','pending'].includes(flow.step)&&<div className="flow-state"><h3>{flow.step==='funded-error'?'Payment received':flow.step==='pending'?'Still confirming':'Unable to continue'}</h3><p role="status">{flow.step==='funded-error'?'Your payment arrived, but the coin purchase needs attention. '+flow.message:flow.message}</p>{pendingRef.current&&<button className="primary" onClick={resume} disabled={busy||!online}>Check again</button>}{pendingRef.current&&<p className="recovery-reference">Keep this reference if you contact support: {pendingRef.current.rampId||pendingRef.current.orderId}</p>}<button className="secondary" onClick={close}>Back to CFK</button></div>}
      {flow.step==='complete'&&<div className="flow-state"><Icon name="check"/><h3>{flow.side==='sell'?'Your CFK is sold':'Your CFK is yours'}</h3><p>{flow.side==='sell'?config?.checkout?.withdrawEnabled?'Your sale is confirmed. Continue to the payment provider to withdraw your SOL balance.':'Your sale is confirmed. Proceeds remain in your account as SOL. Cash withdrawals are not available yet.':flow.positionUpdated?'Your position has been updated.':'Your purchase is confirmed. Your position is refreshing.'}</p>{flow.side==='sell'&&config?.checkout?.withdrawEnabled&&position?.availableUsd>.01&&<button className="primary" onClick={()=>begin('withdraw',Math.floor(position.availableUsd*100)/100)}>Withdraw {formatMoney(position.availableUsd)}</button>}{flow.side==='buy'&&(isGuest||needsEmail)&&<><p>Save your account with email to keep access to your CFK on any device.</p><button className="primary" onClick={saveAccount}>Save my account</button></>}<button className="secondary" onClick={close}>Done</button></div>}
      {flow.step==='paid'&&<div className="flow-state"><Icon name="check"/><h3>Withdrawal confirmed</h3><p>Your payment provider has confirmed the payout. Arrival time depends on your payment method.</p><button className="secondary" onClick={close}>Done</button></div>}
    </Modal>}
    {['disclosures','terms','privacy'].includes(modal)&&<Modal title={{disclosures:'Risk & fee disclosures',terms:'Terms of use',privacy:'Privacy policy'}[modal]} onClose={()=>setModal(null)}><Legal kind={modal}/></Modal>}
    {modal==='measurement'&&<Modal title="Privacy choices" onClose={()=>setModal(null)}><p className="dialog-copy">Allow optional advertising measurement? Buying and selling work with either choice.</p><button className="primary" onClick={()=>chooseConsent('granted')}>Allow measurement</button><button className="secondary" onClick={()=>chooseConsent('denied')}>Essential only</button></Modal>}
    {consent==='unknown'&&<div className="consent" role="region" aria-label="Privacy choices"><span>Allow ad measurement?</span><button onClick={()=>chooseConsent('denied')}>No thanks</button><button className="consent-accept" onClick={()=>chooseConsent('granted')}>Allow</button></div>}
  </>;
}
