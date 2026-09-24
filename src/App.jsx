import React, {lazy, Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {api, formatMoney, formatNumber, shortAddress} from './utils.js';
import {captureAttribution, getSession, getCheckoutId, track, setConsent, getConsent} from './tracking.js';
import Legal from './Legal.jsx';

const Wallet = lazy(() => import('./Wallet.jsx'));
const MINT = '3Rcko4DWwbLQP6vZ2Juxy3gDbv3omNkeg5np17fbpump';

function Icon({name, ...props}) {
  const paths = {plus:'M12 5v14M5 12h14',arrow:'M7 17 17 7M7 7h10v10',down:'M7 7l10 10M7 17h10V7',copy:'M9 9h11v11H9zM15 5V2H2v13h3',close:'m6 6 12 12M6 18 18 6',shield:'m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3Zm-4 9 3 3 5-6',chevron:'m9 5 7 7-7 7',wallet:'M3 6h16v14H3V6Zm0 0V3h13v3M15 11h6v5h-6z'};
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.arrow}/></svg>;
}

function PriceChart({points=[], message}) {
  const [selected,setSelected] = useState(null);
  useEffect(()=>setSelected(null),[points]);
  const values=points.map(p=>p[4]).filter(Number.isFinite);
  const low=Math.min(...values), high=Math.max(...values), span=high-low || high*.1 || 1;
  const y=value=>146-(value-low)/span*118;
  const path=values.map((value,i)=>`${i?'L':'M'}${i/(values.length-1)*560},${y(value)}`).join(' ');
  const point=selected!==null?points[selected]:null;
  return <div className="chart" aria-label="CFK price chart">
    <div className="chart-grid" aria-hidden="true"><i/><i/><i/></div>
    {points.length>1?<><svg viewBox="0 0 560 172" role="img" aria-label={`CFK price over the selected period. Low ${formatMoney(low, true)}, high ${formatMoney(high, true)}.`} onPointerMove={e=>{const b=e.currentTarget.getBoundingClientRect();setSelected(Math.max(0,Math.min(points.length-1,Math.round((e.clientX-b.left)/b.width*(points.length-1)))));}} onPointerLeave={()=>setSelected(null)}><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#278acc" stopOpacity=".2"/><stop offset="100%" stopColor="#278acc" stopOpacity="0"/></linearGradient></defs><path d={`${path} L560,172 L0,172 Z`} fill="url(#fill)"/><path d={path} fill="none" stroke="#278acc" strokeWidth="2.5"/>{point&&<><line x1={selected/(points.length-1)*560} y1="0" x2={selected/(points.length-1)*560} y2="172" stroke="#a5b4c2" strokeDasharray="3 4"/><circle cx={selected/(points.length-1)*560} cy={y(point[4])} r="4" fill="#278acc"/></>}</svg><div className="chart-dates"><span>{new Date(points[0][0]*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span><span>{point?`${formatMoney(point[4],true)} · ${new Date(point[0]*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:'USD'}</span><span>{new Date(points.at(-1)[0]*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span></div></>:<div className="chart-empty"><Icon name="arrow"/><span>{message || 'Price history is unavailable right now.'}</span><small>Verified prices will appear here.</small></div>}
  </div>;
}

function Modal({title,children,onClose}) {
  const ref=useRef(null);
  useEffect(()=>{const d=ref.current;d.showModal();return()=>d.close();},[]);
  return <dialog ref={ref} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="dialog-head"><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close"/></button></div>{children}</dialog>;
}

export default function App(){
  const [config,setConfig]=useState(null),[market,setMarket]=useState(null),[points,setPoints]=useState([]),[activity,setActivity]=useState(null);
  const [range,setRange]=useState('1d'),[amount,setAmount]=useState('50'),[mode,setMode]=useState('buy'),[modal,setModal]=useState(null),[notice,setNotice]=useState('');
  const [walletActive,setWalletActive]=useState(false),[walletState,setWalletState]=useState(null),[walletAction,setWalletAction]=useState(null),[position,setPosition]=useState(null);
  const [consent,setConsentState]=useState(getConsent()),[marketError,setMarketError]=useState(''),[chartError,setChartError]=useState('Loading price history…');
  const [flow,setFlow]=useState({step:'idle'});
  const [walletAttempt,setWalletAttempt]=useState(0);
  const walletBridge=useRef(null),actionLock=useRef(false);
  const mint=config?.mint || MINT;
  const price=market?.priceUsd;
  const refreshPosition=useCallback(async()=>{if(!walletState?.address)return;try{setPosition(await api(`/position?wallet=${walletState.address}`));}catch{setPosition(null);}},[walletState?.address]);
  useEffect(()=>{
    const tg=window.Telegram?.WebApp; tg?.ready();tg?.expand();try{tg?.setHeaderColor('#f5f7f9');tg?.setBackgroundColor('#f5f7f9');}catch{}
    captureAttribution();
    api('/config').then(c=>{setConfig(c);getSession().then(()=>track('ViewContent',{trigger:'coin_page'},c)).catch(()=>{});}).catch(()=>setNotice('The app could not connect. Please refresh.'));
  },[]);
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{
      const results=await Promise.allSettled([api('/market'),api('/activity')]);
      if(!active)return;
      if(results[0].status==='fulfilled'){setMarket(results[0].value);setMarketError(results[0].value.priceUsd===null?'Market data is unavailable right now.':'');}else setMarketError('Market data is unavailable right now.');
      if(results[1].status==='fulfilled')setActivity(results[1].value);else setActivity({items:[],unavailable:true});
    }; refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},30000);return()=>{active=false;clearInterval(timer);};
  },[]);
  useEffect(()=>{let active=true;setPoints([]);setChartError('Loading price history…');api(`/chart?range=${range}`).then(d=>{if(active){setPoints(d.points||[]);setChartError(d.points?.length>1?'':'Price history is unavailable right now.');}}).catch(()=>{if(active)setChartError('Price history is unavailable right now.');});return()=>{active=false;};},[range]);
  useEffect(()=>{refreshPosition();const t=setInterval(()=>{if(!document.hidden)refreshPosition();},20000);return()=>clearInterval(t);},[refreshPosition]);
  useEffect(()=>{if(notice){const t=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(t);}},[notice]);

  async function begin(action){
    if(actionLock.current)return;
    if(action==='buy')track('InitiateCheckout',{trigger:'buy_pressed'},config).catch(()=>{});
    setFlow({step:'idle'});setModal('transaction');setWalletAction(action);
    if(!config?.privyAppId){setFlow({step:'blocked',message:'Wallet setup is being completed. Buying and selling will be available soon.'});return;}
    if(!walletState?.address){setWalletAttempt(n=>n+1);setWalletActive(true);return;}
    await prepare(action,walletBridge.current);
  }
  async function prepare(action,bridge){
    if(!bridge?.address)return;
    actionLock.current=true;setFlow({step:'loading'});
    try{
      const token=await bridge.getAccessToken();
      const balance=await api(`/position?wallet=${bridge.address}`);setPosition(balance);
      if(action==='withdraw'||action==='fund'||(action==='buy'&&balance.availableUsd<Number(amount))){
        const direction=action==='withdraw'?'offramp':'onramp';
        const cents=Math.round(Number(amount)*100);
        if(!Number.isSafeInteger(cents)||cents<=0)throw new Error('Choose an amount greater than $0.');
        const session=await getSession();
        const data=await api('/ramp/session',{method:'POST',token,body:{wallet:bridge.address,direction,grossCents:cents,sessionId:session.id,checkoutId:getCheckoutId(),intent:action==='buy'?'buy':'fund'}});
        setFlow({step:'ramp-review',...data,direction});
      } else {
        const session=await getSession();
        const data=await api('/trade/prepare',{method:'POST',token,body:{wallet:bridge.address,side:action,amountUsd:Number(amount),sessionId:session.id,checkoutId:getCheckoutId()}});
        setFlow({step:'review',...data,side:action});
      }
    }catch(e){setFlow({step:'blocked',message:e.message});}finally{actionLock.current=false;}
  }
  async function confirm(){
    if(actionLock.current)return;actionLock.current=true;const quote=flow;
    try{
      const bridge=walletBridge.current;if(!bridge)throw new Error('Your wallet is not ready.');
      if(Date.parse(quote.expiresAt)<Date.now())throw new Error('This quote expired. Go back and choose Buy or Sell for a fresh price.');
      setFlow({...quote,step:'signing'});
      const signature=await bridge.sign(quote.transaction);
      const token=await bridge.getAccessToken();
      setFlow({...quote,step:'confirming',signature});
      await api('/trade/submit',{method:'POST',token,body:{orderId:quote.orderId,signature}});
      let confirmed=null;
      for(let i=0;i<20;i++){
        const result=await api('/trade/confirm',{method:'POST',token,body:{orderId:quote.orderId}});
        if(result.confirmed){confirmed=result;break;}
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      if(!confirmed){setFlow({step:'pending',signature,message:'Your transaction has been sent. Your balance will update once it is confirmed.'});return;}
      if(confirmed.event)track('Purchase',confirmed.event,config,{verified:true}).catch(()=>{});
      setFlow({step:'complete',side:quote.side,signature});await refreshPosition();
    }catch(e){setFlow({step:'blocked',message:e.message});}finally{actionLock.current=false;}
  }
  const onWalletReady=useCallback(bridge=>{walletBridge.current=bridge;setWalletState({address:bridge.address});},[]);
  const onWalletError=useCallback(message=>setFlow({step:'blocked',message}),[]);
  async function checkPayment(quiet=false){
    try{
      const token=await walletBridge.current.getAccessToken();const data=await api(`/ramp/status?id=${flow.rampId}`,{token});
      if(data.status==='completed'){
        if(data.direction==='onramp'&&data.event)track('InitiateCheckout',{...data.event,trigger:'money_added'},config,{verified:true}).catch(()=>{});
        await refreshPosition();setFlow({step:data.direction==='onramp'?'funded':'paid'});
      }else if(!quiet)setNotice(data.status==='failed'?'The payment did not complete.':'Payment is not confirmed yet.');
    }catch(e){if(!quiet)setNotice(e.message);}
  }
  useEffect(()=>{if(flow.step!=='checkout')return;const timer=setInterval(()=>checkPayment(true),5000);return()=>clearInterval(timer);},[flow.step,flow.rampId]);
  useEffect(()=>{if(walletState?.address&&walletAction&&modal==='transaction'&&flow.step==='idle')prepare(walletAction,walletBridge.current);},[walletState?.address,walletAction,modal,flow.step]);
  const close=()=>{if(actionLock.current)return;setModal(null);setWalletAction(null);setFlow({step:'idle'});};
  const max=()=>{const n=mode==='buy'?position?.availableUsd:position?.valueUsd;if(Number.isFinite(n))setAmount((Math.floor(n*100)/100).toFixed(2));else setNotice('Open your wallet to see your available amount.');};
  function chooseConsent(value){setConsent(value);setConsentState(value);track('ViewContent',{trigger:'coin_page'},config).catch(()=>{});}
  return <>
    <main className="app">
      <header className="header"><div className="brand"><img src="/assets/cashflow-logo.png" width="48" height="48" alt="Cashflow"/><h1>Buy <span>$CFK</span></h1></div><span className="network"><i/>Solana</span></header>
      <section className="wallet-card" aria-label="Your CFK position"><div className="wallet-label"><span>YOUR MONEY</span><button className="wallet-link" onClick={()=>{setWalletAttempt(n=>n+1);setWalletActive(true);setModal('wallet');}}><Icon name="wallet"/>{walletState?.address?shortAddress(walletState.address):'Your wallet'}</button></div><div className="balance">{walletState?.address?formatMoney(position?.totalUsd):'$0.00'}<span>USD</span></div><div className="position-line">{position?.pnlPercent!=null?<><strong className={position.pnlPercent<0?'loss':'gain'}>{position.pnlPercent>=0?'+':''}{position.pnlPercent.toFixed(2)}% ({formatMoney(position.pnlUsd)})</strong><span>your $CFK return</span></>:<span>{walletState?.address?'Your connected wallet balance':'Your $CFK position starts here'}</span>}</div><div className="wallet-split"><div><span>Your $CFK</span><strong>{walletState?.address?formatMoney(position?.valueUsd):'$0.00'}</strong><small>{formatNumber(position?.tokens??0)} CFK</small></div><div><span>Available to buy</span><strong>{walletState?.address?formatMoney(position?.availableUsd):'$0.00'}</strong><small>SOL balance</small></div></div></section>
      <section className="coin-card" aria-label="CASHFLOWKEY market"><div className="coin-heading"><div><h2>CASHFLOWKEY</h2><button className="contract" aria-label="Copy CFK contract address" onClick={()=>navigator.clipboard.writeText(mint).then(()=>setNotice('Contract address copied.')).catch(()=>setNotice(mint))}>$CFK <span>·</span> {shortAddress(mint)} <Icon name="copy"/></button></div><img src="/assets/cashflow-logo.png" width="42" height="42" alt=""/></div><div className="price-row"><strong>{formatMoney(price,true)}</strong><span className={market?.change24h<0?'change loss':'change gain'}>{market?.change24h!=null?`${market.change24h>=0?'+':''}${market.change24h.toFixed(2)}%`:'—'} <small>24h</small></span></div><div className="ranges" role="group" aria-label="Chart period">{[['1h','1H'],['4h','4H'],['1d','1D'],['1w','1W']].map(([key,label])=><button key={key} onClick={()=>setRange(key)} aria-pressed={range===key}>{label}</button>)}<span>{marketError?'Data unavailable':market?.updatedAt?'Updated '+new Date(market.updatedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Connecting…'}</span></div><PriceChart points={points} message={chartError}/><dl className="market-stats"><div><dt>Market cap</dt><dd>{formatMoney(market?.marketCap,true,true)}</dd></div><div><dt>24h change</dt><dd>{market?.change24h!=null?`${market.change24h>=0?'+':''}${market.change24h.toFixed(2)}%`:'—'}</dd></div><div><dt>Holders</dt><dd>{formatNumber(market?.holders)}</dd></div></dl></section>
      <section className="action-card" aria-label="Buy or sell CFK"><div className="action-tabs" role="group" aria-label="Choose buy or sell"><button aria-pressed={mode==='buy'} onClick={()=>{setMode('buy');setAmount('50');}}>Buy</button><button aria-pressed={mode==='sell'} onClick={()=>{setMode('sell');setAmount('50');}}>Sell</button></div><label className="amount-label" htmlFor="amount">{mode==='buy'?'Choose an amount':'Amount to sell'}</label><div className="amount-input"><span>$</span><input id="amount" inputMode="decimal" value={amount} onChange={e=>{if(/^\d{0,8}(\.\d{0,2})?$/.test(e.target.value))setAmount(e.target.value);}} aria-label="Amount in US dollars"/><span>USD</span></div><div className="presets">{mode==='buy'?[20,50,100].map(n=><button key={n} className={Number(amount)===n?'selected':''} onClick={()=>setAmount(String(n))}>${n}</button>):[25,50,75].map(n=><button key={n} onClick={()=>{if(position?.valueUsd)setAmount((Math.floor(position.valueUsd*n)/100).toFixed(2));else setNotice('Open your wallet to see your coins.');}}>{n}%</button>)}<button className="max" onClick={max}>MAX</button></div><button className={`primary ${mode==='sell'?'sell':''}`} disabled={!Number(amount)||actionLock.current} onClick={()=>begin(mode)}>{mode==='buy'?'Buy':'Sell'} {Number(amount)>0?formatMoney(Number(amount)):''} <span>$CFK</span><Icon name={mode==='buy'?'plus':'arrow'}/></button><p className="fee-note">15% fee to add money · 15% fee to cash out<br/>Provider and network costs may also apply.</p><div className="money-actions"><button onClick={()=>begin('fund')}>Add money</button><span>·</span><button onClick={()=>begin('withdraw')}>Cash out</button></div></section>
      <section className="activity" aria-label="Coin activity"><div className="section-heading"><h2>Coin activity</h2><span>{activity?.unavailable?'Unavailable':activity?.items?.length?'Recent buys & sells':'No recent activity'}</span></div><ul>{activity?.items?.length?activity.items.slice(0,8).map(item=><li key={item.id}><span className={`activity-icon ${item.side}`}><Icon name={item.side==='buy'?'plus':'arrow'}/></span><div><strong>{shortAddress(item.wallet)}</strong><small>{item.side==='buy'?'Bought':'Sold'} $CFK</small></div><div className="activity-value"><strong>{formatMoney(item.usd)}</strong><small>{new Date(item.timestamp).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></div><a href={`https://solscan.io/tx/${item.signature}`} target="_blank" rel="noreferrer" aria-label="View transaction"><Icon name="arrow"/></a></li>):<li className="empty-activity"><Icon name="arrow"/><p>{activity?.unavailable?'Coin activity is unavailable right now.':'Confirmed buys and sells will appear here.'}</p></li>}</ul><p className="source-note">{activity?.items?.length?'Activity from the main $CFK pool. Updated every 30 seconds.':'Only verified coin activity is shown.'}</p></section>
      <footer><div className="risk"><Icon name="shield"/><p>Crypto can lose all its value. No returns are guaranteed.<br/>Free Crypto App LLC and related parties may hold or sell $CFK.</p></div><nav aria-label="Legal"><button onClick={()=>setModal('disclosures')}>Disclosures</button><button onClick={()=>setModal('terms')}>Terms</button><button onClick={()=>setModal('privacy')}>Privacy</button><button onClick={()=>setModal('measurement')}>Privacy choices</button></nav><p>Operated by Free Crypto App LLC</p><a href="mailto:support@freecryptoapp.com">support@freecryptoapp.com</a></footer>
    </main>
    {walletActive&&config?.privyAppId&&<Suspense fallback={null}><Wallet appId={config.privyAppId} activation={walletAttempt} onReady={onWalletReady} onError={onWalletError}/></Suspense>}
    {notice&&<div className="toast" role="status">{notice}</div>}
    {modal==='transaction'&&<Modal title={walletAction==='withdraw'?'Cash out':walletAction==='fund'?'Add money':walletAction==='sell'?'Sell $CFK':'Buy $CFK'} onClose={close}>
      {['idle','loading','signing','confirming'].includes(flow.step)&&<div className="flow-state"><div className="spinner"/><h3>{flow.step==='idle'?'Opening your wallet':flow.step==='signing'?'Approve in your wallet':flow.step==='confirming'?'Confirming your coins':'Preparing your amount'}</h3><p>{flow.step==='confirming'?'We’re checking the blockchain. Keep this page open.':'Your funds move only after you confirm.'}</p></div>}
      {flow.step==='blocked'&&<div className="flow-state"><Icon name="wallet"/><h3>Not available yet</h3><p role="alert">{flow.message}</p><button className="secondary" onClick={close}>Back to $CFK</button></div>}
      {flow.step==='review'&&<div className="review"><h3>{formatMoney(flow.amountUsd)}</h3><dl><div><dt>{flow.side==='buy'?'Estimated coins':'Estimated amount'}</dt><dd>{flow.side==='buy'?`${formatNumber(flow.tokens)} CFK`:formatMoney(flow.amountUsd)}</dd></div><div><dt>Maximum price movement</dt><dd>{flow.slippageBps/100}%</dd></div><div><dt>Network reserve</dt><dd>{formatMoney(flow.networkReserveUsd)}</dd></div></dl><p>Review the amount in your wallet. Crypto prices can change and transactions cannot usually be reversed.</p><button className="primary" onClick={confirm}>Confirm {flow.side==='buy'?'buy':'sell'}</button></div>}
      {flow.step==='ramp-review'&&<div className="review"><h3>{formatMoney(flow.grossCents/100)}</h3><dl><div><dt>Platform fee (15%)</dt><dd>{formatMoney(flow.platformFeeCents/100)}</dd></div><div><dt>Provider fees</dt><dd>{formatMoney(flow.providerFeeCents/100)}</dd></div><div><dt>{flow.direction==='onramp'?'Added to your wallet':'Estimated payout'}</dt><dd>{formatMoney(flow.netCents/100)}</dd></div></dl><p>{flow.providerName} handles payment and identity checks. Timing and availability depend on the provider.{flow.direction==='onramp'?' Adding money does not buy CFK. You confirm the coin purchase when funds arrive.':''}</p><button className="primary" onClick={()=>setFlow({...flow,step:"checkout"})}>Continue securely <Icon name="arrow"/></button></div>}
      {flow.step==='checkout'&&<><iframe className="payment-frame" title="Secure payment" src={flow.checkoutUrl} allow="payment" referrerPolicy="strict-origin-when-cross-origin"/><button className="secondary" onClick={()=>checkPayment()}>Check payment status</button></>}
      {flow.step==='paid'&&<div className="flow-state"><Icon name="shield"/><h3>Your cash-out is confirmed</h3><p>Your payment provider has confirmed the payout.</p><button className="primary" onClick={close}>Done</button></div>}
      {flow.step==='funded'&&<div className="flow-state"><Icon name="shield"/><h3>Your money is ready</h3><p>You can now choose your amount and buy $CFK.</p><button className="primary" onClick={close}>Back to $CFK</button></div>}
      {(flow.step==='complete'||flow.step==='pending')&&<div className="flow-state"><Icon name="shield"/><h3>{flow.step==='pending'?'Transaction sent':flow.side==='buy'?'Your $CFK is here':'Your $CFK was sold'}</h3><p>{flow.message||(flow.side==='sell'?'The proceeds are in your wallet. Use Cash out to withdraw through the payment provider.':'Your position has been updated.')}</p><a href={`https://solscan.io/tx/${flow.signature}`} target="_blank" rel="noreferrer">View transaction</a><button className="primary" onClick={close}>Done</button></div>}
    </Modal>}
    {modal==='wallet'&&<Modal title="Your wallet" onClose={close}><div className="flow-state"><Icon name="wallet"/><h3>{walletState?.address?'Your Solana wallet':'Your wallet, with Privy'}</h3><p>{walletState?.address||'Open your wallet when you are ready to buy. Wallet setup is required before adding money.'}</p>{!config?.privyAppId&&<p>Wallet setup is being completed.</p>}<button className="secondary" onClick={close}>Back to $CFK</button></div></Modal>}
    {['disclosures','terms','privacy'].includes(modal)&&<Modal title={{disclosures:'Risk & fee disclosures',terms:'Terms of service',privacy:'Privacy policy'}[modal]} onClose={close}><Legal kind={modal}/></Modal>}
    {modal==='measurement'&&<Modal title="Privacy choices" onClose={close}><p className="dialog-copy">Allow optional advertising measurement to help us understand which ads led to a visit or purchase. You can use the app either way.</p><button className="primary" onClick={()=>{chooseConsent('granted');setModal(null);}}>Allow measurement</button><button className="secondary" onClick={()=>{chooseConsent('denied');setModal(null);}}>Use essential only</button></Modal>}
    {consent==='unknown'&&<div className="consent"><p>Allow optional ad measurement?<br/><small>Your choice won’t affect buying or selling.</small></p><button onClick={()=>chooseConsent('granted')}>Allow</button><button onClick={()=>chooseConsent('denied')}>No thanks</button></div>}
  </>;
}
