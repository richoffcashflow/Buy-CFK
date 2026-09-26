import React,{lazy,Suspense,useCallback,useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api,formatMoney,formatNumber} from './utils.js';
import {captureAttribution,getSession,track,setConsent,getConsent} from './tracking.js';
import Legal from './Legal.jsx';
import PriceChart from './PriceChart.jsx';
import TradeDock from './TradeDock.jsx';
import StripeCheckout from './StripeCheckout.jsx';
import {walletForAction} from './wallet-lifecycle.js';
const Wallet=lazy(()=>import('./Wallet.jsx'));
const MINT='3Rcko4DWwbLQP6vZ2Juxy3gDbv3omNkeg5np17fbpump';
const CREATOR_SOCIALS=[
  {name:'YouTube',icon:'youtube',url:'https://www.youtube.com/@cashflowkeyy'},
  {name:'Instagram',icon:'instagram',url:'https://www.instagram.com/cashflowkeyy/'},
  {name:'X',icon:'x',url:'https://x.com/cashflowkey'},
  {name:'TikTok',icon:'tiktok',url:'https://www.tiktok.com/@richoffcashflow'}
];
function openSocial(event,url){
  const tg=window.Telegram?.WebApp;
  if(!tg?.initData||!tg.openLink||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  try{tg.openLink(url);event.preventDefault();}catch{}
}
const remember={get:k=>{try{return sessionStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{sessionStorage.setItem(k,v);}catch{}},remove:k=>{try{sessionStorage.removeItem(k);}catch{}}};
function readPending(){try{return JSON.parse(remember.get('cfk_pending')||'null');}catch{return null;}}
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
  const [inspected,setInspected]=useState(null),[chartLoading,setChartLoading]=useState(true),[historyStart,setHistoryStart]=useState(null),[customAmount,setCustomAmount]=useState('20'),[loginMethod,setLoginMethod]=useState(null);
  const [range,setRange]=useState('1d'),[amount,setAmount]=useState('20'),[position,setPosition]=useState(null),[notice,setNotice]=useState('');
  const [modal,setModal]=useState(()=>readPending()?'transaction':null),[flow,setFlow]=useState(()=>readPending()?{step:'pending',message:'Continue to check your previous payment or coin purchase.'}:{step:'idle'}),[intent,setIntent]=useState('buy');
  const [consent,setConsentState]=useState(getConsent()),[chartMessage,setChartMessage]=useState('Loading price history…');
  // Telegram restores the account in the background. Privy wallet creation
  // remains deferred until a funded buy is actually prepared.
  const [walletActive,setWalletActive]=useState(()=>Boolean(window.Telegram?.WebApp?.initData||readPending()));
  const [activation,setActivation]=useState(0),[account,setAccount]=useState(null),[busy,setBusy]=useState(false);
  const bridgeRef=useRef(null),lock=useRef(false),queuedAction=useRef(null),pendingRef=useRef(readPending());
  const savePending=data=>{pendingRef.current=data;if(data)remember.set('cfk_pending',JSON.stringify(data));else {remember.remove('cfk_pending');remember.remove('cfk_payment_attempt');}};
  const setLock=value=>{lock.current=value;setBusy(value);};
  const refreshPosition=useCallback(async()=>{const b=bridgeRef.current;if(!b)return;if(!b.address){setPosition({valueUsd:0,tokens:0,availableUsd:0});return;}try{const next=await api('/position?wallet='+b.address);setPosition(next);}catch{}},[]);
  useEffect(()=>{
    const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();try{tg?.setHeaderColor('#ffffff');tg?.setBackgroundColor('#ffffff');}catch{}
    if(tg?.initData)setWalletActive(true);
    captureAttribution();api('/config').then(c=>{setConfig(c);getSession().then(()=>track('ViewContent',{trigger:'coin_page'},c)).catch(()=>{});}).catch(()=>setNotice('Please refresh to reconnect.'));
  },[]);
  useEffect(()=>{
    let alive=true;const refresh=()=>{api('/market').then(d=>{if(alive)setMarket(d);}).catch(()=>{});api('/activity').then(d=>{if(alive)setActivity(d);}).catch(()=>{if(alive)setActivity({items:[],unavailable:true});});};
    refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},30000);return()=>{alive=false;clearInterval(timer);};
  },[]);
  useEffect(()=>{
    let alive=true;setPoints([]);setChartLoading(true);setHistoryStart(null);setInspected(null);setChartMessage('Loading price history…');const refresh=()=>api('/chart?range='+range).then(d=>{if(alive){setPoints(d.points||[]);setHistoryStart(d.buildingHistory||range==='all'?d.historyStart:null);setChartLoading(false);setChartMessage(d.buildingHistory?'Building price history':'Price history is unavailable right now.');}}).catch(()=>{if(alive){setChartLoading(false);setChartMessage('Price history is unavailable right now.');}});
    refresh();const t=setInterval(()=>{if(!document.hidden)refresh();},60000);return()=>{alive=false;clearInterval(t);};
  },[range]);
  useEffect(()=>{refreshPosition();const t=setInterval(()=>{if(!document.hidden)refreshPosition();},20000);return()=>clearInterval(t);},[account,refreshPosition]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(t);},[notice]);
  const onReady=useCallback(bridge=>{const previous=bridgeRef.current;bridgeRef.current=bridge;setAccount(bridge.userId);if(previous&&previous.address!==bridge.address)refreshPosition();},[refreshPosition]);
  const onError=useCallback(message=>{setFlow({step:'auth-error',message});setModal('transaction');},[]);
  const onCancelSignIn=useCallback(()=>{queuedAction.current=null;setFlow({step:'idle'});setModal(null);setWalletActive(false);},[]);
  function signIn(method=null){setLoginMethod(method);setModal('transaction');setFlow({step:'sign-in'});setWalletActive(true);setActivation(n=>n+1);}
  function begin(side,override){
    if(lock.current)return;
    setIntent(side);
    if(side==='buy')track('InitiateCheckout',{trigger:'buy_pressed'},config).catch(()=>{});
    setModal('transaction');
    if(side==='withdraw'&&pendingRef.current?.type==='funded')savePending(null);
    if(pendingRef.current){setFlow({step:'pending',message:'Your previous payment or trade is still being checked.'});if(bridgeRef.current)resume();else{setWalletActive(true);setActivation(n=>n+1);}return;}
    const selected=override??Number(amount);
    if(!Number.isFinite(selected)||selected<=0){setFlow({step:'blocked',message:'Choose an amount greater than $0.'});return;}
    if(!config?.privyAppId){setFlow({step:'blocked',message:'Buying and selling are being connected. No payment has been taken.'});return;}
    if(side==='buy'&&config.checkout?.buyEnabled!==true){setFlow({step:'blocked',checkoutDisabled:true,message:'Live buying is not enabled yet. Open the test checkout to continue testing. No payment has been taken.'});return;}
    queuedAction.current={side,amountUsd:selected};
    if(!bridgeRef.current){signIn();return;}
    setFlow({step:'idle'});
    if(bridgeRef.current){const action=queuedAction.current;queuedAction.current=null;prepare(action);}
  }
  async function prepare(action){
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
        let attempt;try{attempt=JSON.parse(remember.get('cfk_payment_attempt')||'null');}catch{}
        if(!attempt||attempt.amountUsd!==action.amountUsd||attempt.wallet!==address||attempt.direction!==direction){attempt={id:crypto.randomUUID(),amountUsd:action.amountUsd,wallet:address,direction};remember.set('cfk_payment_attempt',JSON.stringify(attempt));}
        const data=await api('/ramp/session',{method:'POST',token,body:{wallet:address,direction,grossCents:Math.round(action.amountUsd*100),sessionId:session.id,checkoutId:attempt.id,intent:action.side}});
        if(data.existingPayment){savePending({type:'payment',direction,provider:data.provider,rampId:data.rampId});setFlow({step:'pending',message:'Checking your existing payment…'});}
        else if(data.provider==='stripe'&&direction==='onramp')startPayment({direction,...data});
        else setFlow({step:'ramp-review',direction,...data});
      }else{
        const data=await api('/trade/prepare',{method:'POST',token,body:{wallet:address,side:'sell',amountUsd:action.amountUsd,sessionId:session.id}});
        await execute(data,'sell');
      }
    }catch(e){setFlow({step:'blocked',message:e.message});}finally{setLock(false);}
  }
  async function execute(quote,side){
    if(quote.existingOrder){savePending({type:'trade',orderId:quote.orderId,side,signature:quote.signature});return confirmPending(pendingRef.current);}
    setFlow({step:'buying',side});
    const transaction=await bridgeRef.current.sign(quote.transaction);
    const pending={type:'trade',orderId:quote.orderId,transaction,side};
    savePending(pending);return confirmPending(pending);
  }
  async function confirmPending(pending){
    const token=await bridgeRef.current.getAccessToken();setFlow({step:'confirming',side:pending.side});
    if(pending.transaction){const submitted=await api('/trade/submit',{method:'POST',token,body:{orderId:pending.orderId,transaction:pending.transaction}});pending={...pending,signature:submitted.signature};savePending(pending);}
    let result;
    for(let i=0;i<12;i++){result=await api('/trade/confirm',{method:'POST',token,body:{orderId:pending.orderId}});if(result.confirmed)break;await new Promise(resolve=>setTimeout(resolve,1500));}
    if(!result?.confirmed){setFlow({step:'pending',message:'Your transaction is still confirming. We will keep checking it.'});return;}
    savePending(null);if(result.event)track('Purchase',result.event,config,{verified:true}).catch(()=>{});
    setFlow({step:'complete',side:result.side,signature:result.signature});await refreshPosition();
  }
  async function buyFunded(pending){
    const b=bridgeRef.current,token=await b.getAccessToken(),session=await getSession();setFlow({step:'buying',side:'buy'});
    const quote=await api('/trade/prepare',{method:'POST',token,body:{wallet:b.address,side:'buy',fundingId:pending.rampId,sessionId:session.id}});
    await execute(quote,'buy');
  }
  async function resume(){
    const pending=pendingRef.current;if(!pending||lock.current)return;if(!bridgeRef.current){signIn();return;}setLock(true);
    try{
      if(pending.type==='trade'){await confirmPending(pending);return;}
      const result=await api('/ramp/status?id='+pending.rampId,{token:await bridgeRef.current.getAccessToken()});
      if(result.status==='failed'){savePending(null);throw new Error('The payment did not complete.');}
      if(result.status==='review_required'){setFlow({step:'funding-review',...result});return;}
      if(result.status==='sandbox_complete'){savePending(null);setFlow({step:'sandbox-complete'});return;}
      if(result.status!=='completed'){setFlow({step:'checkout',...pending,...result});return;}
      if(result.direction==='offramp'){savePending(null);setFlow({step:'paid'});await refreshPosition();return;}
      if(result.event)track('InitiateCheckout',{...result.event,trigger:'money_added'},config,{verified:true}).catch(()=>{});
      savePending({...pending,type:'funded'});await buyFunded(pending);
    }catch(e){
      const p=pendingRef.current;if(e.status===409&&p?.type==='trade')savePending(null);
      setFlow({step:p?.type==='funded'?'funded-error':'blocked',message:e.message});await refreshPosition();
    }finally{setLock(false);}
  }
  useEffect(()=>{
    if(!account||!config)return;
    if(queuedAction.current){const action=queuedAction.current;queuedAction.current=null;prepare(action);}
    else if(pendingRef.current)resume();
    else {setFlow({step:'idle'});setModal(null);}
  },[account,config]);
  useEffect(()=>{if(!account||!['checkout','pending'].includes(flow.step))return;const t=setInterval(()=>resume(),5000);return()=>clearInterval(t);},[account,flow.step]);
  function startPayment(payment){const pending={type:'payment',provider:payment.provider,direction:payment.direction,rampId:payment.rampId,checkoutUrl:payment.checkoutUrl,grossCents:payment.grossCents,netCents:payment.netCents};savePending(pending);setFlow({...payment,...pending,step:'checkout'});}
  function openPayment(){startPayment(flow);}
  async function approveFunding(){
    if(lock.current)return;setLock(true);
    try{const result=await api('/ramp/approve',{method:'POST',token:await bridgeRef.current.getAccessToken(),body:{rampId:flow.rampId,reviewToken:flow.reviewToken}});
      if(result.status==='review_required'){setFlow({step:'funding-review',...result});return;}
      setFlow({step:'pending',message:'Your payment is verified. Preparing your CFK purchase…'});
    }catch(e){setFlow({step:'blocked',message:e.message});}finally{setLock(false);}
  }
  function chooseConsent(value){setConsent(value);setConsentState(getConsent());track('ViewContent',{trigger:'coin_page'},config).catch(()=>{});if(modal==='measurement')setModal(null);}
  const close=()=>{if(lock.current)return;queuedAction.current=null;setModal(null);};
  const change=market?.change24h,changeText=change!=null?(change>=0?'+':'')+change.toFixed(2)+'%':'—';
  return <>
    <main className="app">
      <header className="coin-identity">
        <div className="coin-identity-main"><img src="/assets/cfk-coin.png" width="48" height="48" alt="Cashflow"/><div><h1>CASHFLOWKEY</h1><span>$CFK</span></div></div>
        <p className="brand-tagline">Buy, track, and sell $CFK.<span>All in one place.</span></p>
      </header>
      <section className="coin-card" aria-label="Cashflowkey market">
        <div className="price-heading"><h2>$CFK Price</h2><span className="price-currency">USD</span></div>
        <div className="price-row"><strong>{formatMoney(inspected?.[4]??market?.priceUsd,true)}</strong><div className="price-detail">{inspected?<span className="inspected-time">{new Date(inspected[0]*1000).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}<small>Historical price</small></span>:<span className={change==null?'change muted':change<0?'change loss':'change gain'}>{changeText}<small>past 24 hours</small></span>}</div></div>
        <PriceChart key={range} points={points} message={chartMessage} loading={chartLoading} historyStart={historyStart} onInspect={setInspected}/>
        <div className="ranges" role="group" aria-label="Chart period">{[['1h','1H'],['1d','1D'],['1w','1W'],['1m','1M'],['all','ALL']].map(([key,label])=><button key={key} aria-pressed={range===key} onClick={()=>setRange(key)}>{label}</button>)}</div>
        <div className="inline-trade" role="group" aria-label="Trade below the chart"><button className="primary" disabled={busy} onClick={()=>begin('buy')}>Buy now</button><button className="primary sell" disabled={busy} onClick={()=>begin('sell')}>Sell my CFK</button></div>
      </section>
      <section className="market-card" aria-label="24 hour market"><h2>24h market</h2><dl className="market-stats"><div><dt>Market cap</dt><dd>{formatMoney(market?.marketCap,true,true)}</dd></div><div><dt>24h volume</dt><dd>{formatMoney(market?.volume24h,true,true)}</dd></div><div><dt>Holders</dt><dd>{formatNumber(market?.holders)}</dd></div><div><dt>24h change</dt><dd className={change==null?'muted':change<0?'loss':'gain'}>{changeText}</dd></div></dl></section>
      <section id="position" className="position-card" aria-label="Your position"><div className="position-heading"><h2>Your Position</h2><span className="token-badge">$CFK</span></div><div className="position-value"><div><span>Current value</span><strong>{account?formatMoney(position?.valueUsd):'—'}</strong></div>{position?.pnlPercent!=null&&<div className="position-return"><strong className={position.pnlPercent<0?'loss':'gain'}>{position.pnlPercent>=0?'+':''}{position.pnlPercent.toFixed(2)}%</strong><small>{formatMoney(position.pnlUsd)} return</small></div>}</div><div className="position-tokens"><div><span>Tokens owned</span><strong>{formatNumber(account?position?.tokens:null)}</strong></div><span className="token-badge">$CFK</span></div></section>
      <section className="activity" aria-label="Coin activity"><div className="section-heading"><h2>Coin Activity</h2><span className="activity-badge">Latest trades</span></div><div className="activity-status"><span className={activity?.unavailable?'status-dot offline':'status-dot'}/><span>{activity?.unavailable?'Reconnecting to activity':'Recent buys & sells'}</span><small>{activity?.updatedAt?'Updated '+new Date(activity.updatedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Connecting…'}</small></div><ul>{activity?.items?.length?activity.items.slice(0,10).map(item=><li key={item.id}><span className={'activity-icon '+item.side}><Icon name={item.side==='buy'?'plus':'arrow'}/></span><div><strong>{item.side==='buy'?'Bought':'Sold'} CFK</strong><small>{new Date(item.timestamp).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small></div><div className="activity-value"><strong>{item.usd!=null?formatMoney(item.usd):formatNumber(item.tokens)+' CFK'}</strong></div><a href={'https://solscan.io/tx/'+item.signature} target="_blank" rel="noreferrer" aria-label="View transaction"><Icon/></a></li>):<li className="empty-activity"><p>{activity?.unavailable?'Activity is unavailable right now.':'Confirmed buys and sells will appear here.'}</p></li>}</ul><p className="source-note">Confirmed coin activity. Prices shown in USD when available.</p></section>
      <section className="about-coin" aria-labelledby="about-heading"><div className="about-heading"><span className="brand-eyebrow">GET TO KNOW THE COIN</span><span className="token-badge">$CFK</span></div><h2 id="about-heading">What is Cashflowkey?</h2><p>CASHFLOWKEY ($CFK) is a crypto token on Solana. Follow its price, see your position, and keep up with recent buys and sells here.</p></section>
      <section className="creator-card" aria-labelledby="creator-heading">
        <div className="creator-photo"><img src="/assets/cashflowkey-creator.jpg" width="1152" height="2048" loading="lazy" decoding="async" alt="Cashflowkey seated in a vehicle with an orange interior"/><span className="creator-photo-label">THE NAME BEHIND $CFK</span></div>
        <div className="creator-body"><span className="brand-eyebrow">MEET THE CREATOR</span><h2 id="creator-heading">Cashflowkey</h2><p>Entrepreneur. Creator. Follow the person behind $CFK.</p><nav className="creator-socials" aria-label="Creator social profiles">{CREATOR_SOCIALS.map(social=><a key={social.name} href={social.url} target="_blank" rel="noopener noreferrer" aria-label={'Cashflowkey on '+social.name+' (opens in a new tab)'} title={social.name} onClick={event=>openSocial(event,social.url)}><img src={'/assets/social-'+social.icon+'.svg'} width="19" height="19" alt=""/><span>{social.name}</span></a>)}</nav></div>
      </section>
      <footer><p>Crypto can lose all its value. No returns are guaranteed.<br/>Free Crypto App LLC and related parties may hold or sell CFK.</p><nav aria-label="Legal"><button onClick={()=>setModal('disclosures')}>Disclosures</button><button onClick={()=>setModal('terms')}>Terms</button><button onClick={()=>setModal('privacy')}>Privacy</button><button onClick={()=>setModal('measurement')}>Privacy choices</button></nav><p>Operated by Free Crypto App LLC</p><a href="mailto:support@freecryptoapp.com">support@freecryptoapp.com</a></footer>
    </main>
    <TradeDock amount={amount} setAmount={setAmount} onBuy={()=>begin('buy')} onSell={()=>begin('sell')} onCustom={()=>{setCustomAmount(amount);setModal('amount');}} busy={busy} openingSignIn={flow.step==='sign-in'} />
    {modal==='amount'&&<Modal title="Choose your amount" onClose={()=>setModal(null)}><form onSubmit={e=>{e.preventDefault();if(Number(customAmount)>0){setAmount(customAmount);setModal(null);}}}><label className="custom-label" htmlFor="custom-amount">How much would you like to spend?</label><div className="custom-amount"><span>$</span><input autoFocus id="custom-amount" aria-label="Custom amount in US dollars" inputMode="decimal" value={customAmount} onChange={e=>{if(/^\d{0,8}(\.\d{0,2})?$/.test(e.target.value))setCustomAmount(e.target.value);}}/><span>USD</span></div><button className="primary" disabled={!Number(customAmount)} type="submit">Use {formatMoney(Number(customAmount)||0)}</button></form></Modal>}
    {walletActive&&config?.privyAppId&&<Suspense fallback={null}><Wallet appId={config.privyAppId} activation={activation} loginMethod={loginMethod} onReady={onReady} onError={onError} onCancel={onCancelSignIn}/></Suspense>}
    {notice&&<div className="toast" role="status">{notice}</div>}
    {modal==='transaction'&&<Modal title={intent==='withdraw'?'Withdraw cash':intent==='sell'?'Sell CFK':'Buy CFK'} onClose={close}>
      {flow.step==='auth-error'&&<div className="flow-state"><h3>Let’s reconnect your account</h3><p role="status">{flow.message}</p><button className="primary" onClick={()=>window.Telegram?.WebApp?.initData?location.reload():signIn('telegram')}>Try again</button></div>}
      {['sign-in','idle','loading','buying','confirming'].includes(flow.step)&&<div className="flow-state"><div className="spinner"/><h3>{flow.step==='sign-in'?'Connecting your account':flow.step==='idle'?'Getting you ready':flow.step==='confirming'?'Confirming your transaction':flow.step==='buying'?(flow.side==='sell'?'Selling your CFK':'Buying your CFK'):'Preparing your amount'}</h3><p>{flow.step==='sign-in'?'Connecting securely through Telegram…':flow.step==='idle'?'Preparing your account.':'You can follow the progress here.'}</p></div>}
      {flow.step==='ramp-review'&&<div className="review"><h3>{formatMoney(flow.grossCents/100)}</h3><dl><div><dt>Platform fee · 15%</dt><dd>{formatMoney(flow.platformFeeCents/100)}</dd></div><div><dt>Payment provider fee</dt><dd>{formatMoney(flow.providerFeeCents/100)}</dd></div><div><dt>{flow.direction==='onramp'?'Available for CFK & extra costs':'Estimated cash payout'}</dt><dd>{formatMoney(flow.netCents/100)}</dd></div></dl><p>{flow.direction==='onramp'?'After payment is confirmed, we automatically buy CFK with these funds, allowing up to 1% price movement. Coin purchase and network costs are extra. Any unused funds stay in your account.':'Complete the payment provider’s withdrawal process to receive your cash.'}</p><button className="primary" onClick={openPayment}>{flow.direction==='onramp'?'Pay '+formatMoney(flow.grossCents/100)+' & buy CFK':'Continue withdrawal'}</button></div>}
      {flow.step==='checkout'&&<>{flow.provider==='stripe'&&<div className="checkout-summary"><p className="dialog-copy"><strong>Payment handled by Stripe</strong><br/>Use your saved payment method in Link when available.</p><p className="dialog-copy">Stripe may ask for your SSN to verify your identity (KYC). Enter it only in Stripe’s secure form. Buy CFK does not collect or store your SSN.</p><p className="dialog-copy">Selected total: <strong>{formatMoney(flow.grossCents/100)}</strong> · Includes our 15% fee ({formatMoney(flow.platformFeeCents/100)}) and an estimated {formatMoney(flow.providerFeeCents/100)} payment provider fee.</p></div>}{flow.provider==='stripe'?(flow.clientSecret?<StripeCheckout publishableKey={flow.publishableKey} clientSecret={flow.clientSecret} onUpdate={resume}/>:<p role="status">Restoring your secure payment…</p>):<iframe className="checkout-frame" src={flow.checkoutUrl} title="Secure payment" allow="payment" referrerPolicy="no-referrer"/>}<p className="dialog-copy">{flow.direction==='onramp'?'Your CFK purchase starts automatically after your payment is verified.':'Your payout is confirmed by the payment provider.'}</p><button className="secondary" disabled={busy} onClick={resume}>Check payment</button></>}
      {flow.step==='funding-review'&&<div className="review"><h3>Your payment amount changed</h3><p>You paid {formatMoney(flow.grossCents/100)}. Review the updated amounts before buying CFK.</p><dl><div><dt>Platform fee · 15%</dt><dd>{formatMoney(flow.platformFeeCents/100)}</dd></div><div><dt>Payment provider fee</dt><dd>{formatMoney(flow.providerFeeCents/100)}</dd></div><div><dt>Available for CFK & extra costs</dt><dd>{formatMoney(flow.netCents/100)}</dd></div></dl><button className="primary" disabled={busy} onClick={approveFunding}>Accept & buy CFK</button><button className="secondary" onClick={close}>Decide later</button></div>}
      {flow.step==='sandbox-complete'&&<div className="flow-state"><h3>Test payment complete</h3><p>No real money moved and no CFK was purchased.</p><button className="secondary" onClick={close}>Done</button></div>}
      {['blocked','funded-error','pending'].includes(flow.step)&&<div className="flow-state"><h3>{flow.step==='funded-error'?'Payment received':flow.step==='pending'?'Still confirming':'Unable to continue'}</h3><p role="status">{flow.step==='funded-error'?'Your payment arrived, but the coin purchase needs attention. '+flow.message:flow.message}</p>{pendingRef.current&&<button className="primary" onClick={resume} disabled={busy}>Check again</button>}{flow.checkoutDisabled&&<><button className="primary" onClick={()=>{const target=new URL('https://buy-cfk-git-stripe-sandbox-cashflowkey.vercel.app/');target.hash=location.hash;location.assign(target.href);}}>Open test checkout</button><small style={{overflowWrap:'anywhere'}}>App address: {location.hostname} · {config?.sandbox?'Test':'Live'} · checkout fix 1</small></>}<button className="secondary" onClick={close}>Back to CFK</button></div>}
      {flow.step==='complete'&&<div className="flow-state"><Icon name="check"/><h3>{flow.side==='sell'?'Your CFK is sold':'Your CFK is yours'}</h3><p>{flow.side==='sell'?'Your proceeds are available in dollars. You can withdraw your cash now.':'Your position has been updated.'}</p>{flow.side==='sell'&&position?.availableUsd>.01&&<button className="primary" onClick={()=>begin('withdraw',Math.floor(position.availableUsd*100)/100)}>Withdraw {formatMoney(position.availableUsd)}</button>}<button className="secondary" onClick={close}>Done</button></div>}
      {flow.step==='paid'&&<div className="flow-state"><Icon name="check"/><h3>Withdrawal confirmed</h3><p>Your payment provider has confirmed the payout. Arrival time depends on your payment method.</p><button className="secondary" onClick={close}>Done</button></div>}
    </Modal>}
    {['disclosures','terms','privacy'].includes(modal)&&<Modal title={{disclosures:'Risk & fee disclosures',terms:'Terms of use',privacy:'Privacy policy'}[modal]} onClose={()=>setModal(null)}><Legal kind={modal}/></Modal>}
    {modal==='measurement'&&<Modal title="Privacy choices" onClose={()=>setModal(null)}><p className="dialog-copy">Allow optional advertising measurement? Buying and selling work with either choice.</p><button className="primary" onClick={()=>chooseConsent('granted')}>Allow measurement</button><button className="secondary" onClick={()=>chooseConsent('denied')}>Essential only</button></Modal>}
    {consent==='unknown'&&<div className="consent" role="region" aria-label="Privacy choices"><span>Allow ad measurement?</span><button onClick={()=>chooseConsent('denied')}>No thanks</button><button className="consent-accept" onClick={()=>chooseConsent('granted')}>Allow</button></div>}
  </>;
}
