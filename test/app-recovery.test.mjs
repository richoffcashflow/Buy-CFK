import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
const require=createRequire(import.meta.url);
const output=await build({entryPoints:[new URL('../src/App.jsx',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'isolated-ui-fixtures',setup(b){
  b.onResolve({filter:/^(react|react-dom)$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));
  b.onResolve({filter:/\/(Wallet|PriceChart|StripeCheckout)\.jsx$/},args=>({path:args.path,namespace:'ui-fixture'}));
  b.onLoad({filter:/.*/,namespace:'ui-fixture'},args=>({loader:'jsx',contents:args.path.endsWith('Wallet.jsx')?`import React from 'react'; export default function Wallet(props){globalThis.cfkWalletProps=props;return props.loginMethod==='guest'||props.activation===0?null:<div role="dialog" aria-label="Mock secure sign-in">Mock secure sign-in</div>;}`:`export default function Fixture(){return null;}`}));
  b.onResolve({filter:/\/tracking\.js$/},()=>({path:'tracking',namespace:'tracking-fixture'}));
  b.onLoad({filter:/.*/,namespace:'tracking-fixture'},()=>({contents:`export const configureMeasurement=()=>'denied',getSession=async()=>({id:'test-session'}),track=async()=>{},setConsent=()=>{},getConsent=()=>'denied';`}));
}}]});
const {default:App}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
async function fixture({pending,accountSeen=false,installSeen=true,standalone=false,buyEnabled=false,withdrawEnabled=false,guestCheckoutEnabled=false,purchaseIntent,position={tokens:0,valueUsd:0,availableUsd:0},responses={}}={}){
  const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/'});
  const originals=new Map();
  for(const [key,value] of Object.entries({window:dom.window,navigator:dom.window.navigator,document:dom.window.document,sessionStorage:dom.window.sessionStorage,localStorage:dom.window.localStorage,location:dom.window.location,ResizeObserver:class{observe(){}disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  if(purchaseIntent)dom.window.sessionStorage.setItem('cfk_purchase_intent',JSON.stringify(purchaseIntent));
  if(pending)dom.window.localStorage.setItem('cfk_pending',JSON.stringify(pending));
  if(accountSeen)dom.window.localStorage.setItem('cfk_account_seen','1');
  if(installSeen)dom.window.localStorage.setItem('cfk_install_seen:test-user','1');
  if(standalone)dom.window.matchMedia=()=>({matches:true});
  const requests=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    requests.push({url,...options});
    let result;
    if(url==='/api/config')result={privyAppId:'test-privy-app',guestCheckoutEnabled,checkout:{buyEnabled,withdrawEnabled}};
    else if(url==='/api/market')result={priceUsd:1};
    else if(url==='/api/activity')result={items:[]};
    else if(url.startsWith('/api/chart'))result={points:[]};
    else if(url.startsWith('/api/position'))result=typeof position==='function'?position():position;
    else if(url==='/api/account/history'&&!responses[url])result={items:[]};
    else if(responses[url])result=await responses[url](options);
    else throw new Error('Unexpected isolated request: '+url);
    return new Response(JSON.stringify(result.body??result),{status:typeof result.status==='number'?result.status:200,headers:{'Content-Type':'application/json'}});
  };
  const root=createRoot(dom.window.document.getElementById('root'));
  await act(async()=>root.render(React.createElement(App)));
  const buttons=()=>[...document.querySelectorAll('button')];
  const click=async text=>{const button=buttons().find(b=>b.textContent===text);assert.ok(button,`Missing button: ${text}`);assert.equal(button.disabled,false);await act(async()=>button.click());};
  let signs=0,upgrades=0;
  const bridge={upgrade:()=>{upgrades++;},userId:'test-user',address:'test-wallet',getAccessToken:async()=>'test-token',sign:async()=>{signs++;return 'signed-fixture';}};
  return {dom,requests,click,bridge,signs:()=>signs,upgrades:()=>upgrades,text:()=>document.body.textContent,signIn:async()=>{await click('Sign in to your account');await act(async()=>globalThis.cfkWalletProps.onReady(bridge));},close:async()=>{await act(async()=>root.unmount());globalThis.fetch=originalFetch;delete globalThis.cfkWalletProps;for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}dom.window.close();}};
}

test('returning users can sign in without starting a buy; provider gets an unobstructed dialog',async()=>{
  const f=await fixture({buyEnabled:false});
  try{
    assert.equal(globalThis.cfkWalletProps,undefined);
    assert.deepEqual([...document.querySelectorAll('.creator-socials a')].map(a=>a.href),['https://www.instagram.com/cashflowkeyy/']);
    assert.doesNotMatch(f.text(),/Telegram|TikTok|YouTube/);
    assert.equal(document.querySelector('.coin-identity h1').textContent,'Cashflowkey');
    assert.equal(document.querySelector('.coin-identity .brand-account-label').textContent,'CFK');
    assert.equal(document.querySelector('.header-sign-in').textContent,'Sign in');
    await f.click('Sign in');
    assert.equal(document.querySelectorAll('[role="dialog"]').length,1);
    assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-label'),'Mock secure sign-in');
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
    await f.click('Cancel sign-in');
    assert.equal(document.querySelector('[role="dialog"]'),null);
    await f.signIn();
    assert.match(f.text(),/CFK value\$0\.00/);
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
  }finally{await f.close();}
});

test('a remembered account restores quietly without opening login or starting a payment',async()=>{
  const f=await fixture({accountSeen:true,buyEnabled:true,guestCheckoutEnabled:true});
  try{
    assert.equal(globalThis.cfkWalletProps.activation,0);
    assert.equal(document.querySelector('[role="dialog"]'),null);
    f.bridge.displayName='Taylor';
    await act(async()=>globalThis.cfkWalletProps.onReady(f.bridge));
    assert.match(document.querySelector('.account-welcome').textContent,/Hello, Taylor/);
    assert.equal(document.querySelector('.header-sign-in'),null);
    assert.ok(document.querySelector('.account-avatar'));
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
    assert.equal(f.signs(),0);
  }finally{await f.close();}
});

test('an existing funded account can add email without replacing its identity or starting a payment',async()=>{
  const f=await fixture({position:{tokens:25,valueUsd:25,availableUsd:0}});
  try{
    f.bridge.needsEmail=true;
    await f.signIn();
    assert.match(document.querySelector('.save-account').textContent,/Save your account/);
    assert.doesNotMatch(document.querySelector('.save-account').textContent,/expires after 30 days/);
    await f.click('Save with email');
    assert.equal(f.upgrades(),1);
    await act(async()=>globalThis.cfkWalletProps.onReady({...f.bridge,needsEmail:false}));
    assert.equal(document.querySelector('.save-account'),null);
    assert.match(f.text(),/CFK value\$25\.00/);
    assert.equal(f.signs(),0);
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
  }finally{await f.close();}
});

test('a week-old payment stays recoverable without opening sign-in on page load',async()=>{
  const pending={type:'payment',rampId:'old-payment',userId:'test-user',savedAt:Date.now()-7*86400000};
  const f=await fixture({pending,responses:{'/api/ramp/status?id=old-payment':()=>({status:'pending',direction:'onramp'})}});
  try{
    assert.equal(globalThis.cfkWalletProps,undefined);
    assert.match(f.text(),/Check previous payment or trade/);
    assert.equal(JSON.parse(localStorage.getItem('cfk_pending')).rampId,'old-payment');
    await f.click('Check previous payment or trade');
    assert.equal(document.querySelectorAll('[aria-modal="true"]').length,0);
    await act(async()=>globalThis.cfkWalletProps.onReady(f.bridge));
    assert.ok(f.requests.some(r=>r.url==='/api/ramp/status?id=old-payment'));
  }finally{await f.close();}
});

test('sale review shows unavailable cash withdrawals before any signature and can be cancelled',async()=>{
  const f=await fixture({position:{tokens:40,valueUsd:40,availableUsd:12.34},responses:{'/api/trade/prepare':()=>({orderId:'sale',transaction:'unsigned-fixture',amountUsd:19.4,tokens:20,slippageBps:100})}});
  try{
    await f.signIn();
    assert.match(f.text(),/Available balance\$12\.34/);
    assert.match(f.text(),/Cash withdrawals are not available yet/);
    assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent==='Withdraw cash'),false);
    await f.click('Sell');
    assert.match(f.text(),/Review sale/);
    assert.match(document.querySelector('[aria-modal="true"]').textContent,/does not pay cash to your bank/);
    assert.equal(f.signs(),0);
    await f.click('Cancel');
    assert.equal(document.querySelector('[aria-modal="true"]'),null);
    assert.equal(f.signs(),0);
    assert.ok(!f.requests.some(r=>r.url==='/api/trade/submit'));
  }finally{await f.close();}
});

test('a confirmation conflict does not erase the payment reference',async()=>{
  const pending={type:'trade',orderId:'old-order',rampId:'paid-ramp',side:'buy',userId:'test-user',savedAt:1};
  const f=await fixture({pending,responses:{'/api/trade/confirm':()=>({status:409,body:{message:'The transaction needs attention.'}})}});
  try{
    await f.click('Check previous payment or trade');
    await act(async()=>globalThis.cfkWalletProps.onReady(f.bridge));
    assert.equal(JSON.parse(localStorage.getItem('cfk_pending')).rampId,'paid-ramp');
    assert.match(f.text(),/paid-ramp/);
    assert.match(f.text(),/Check again/);
  }finally{await f.close();}
});


test('server history restores a payment after browser storage was cleared without starting a new checkout',async()=>{
  const f=await fixture({responses:{
    '/api/account/history':()=>({items:[{kind:'payment',id:'server-payment',action:'onramp',status:'completed',amountCents:2000,createdAt:'2026-09-20T00:00:00Z',recoverable:true}]}),
    '/api/ramp/status?id=server-payment':()=>({status:'pending',direction:'onramp'})
  }});
  try{
    await f.signIn();
    assert.match(f.text(),/Recent account activity/);
    assert.match(f.text(),/server-payment/);
    assert.equal(f.requests.filter(r=>r.url.includes('/ramp/')).length,0);
    await f.click('Review');
    assert.equal(JSON.parse(localStorage.getItem('cfk_pending')).rampId,'server-payment');
    assert.ok(f.requests.some(r=>r.url==='/api/ramp/status?id=server-payment'));
    assert.equal(f.requests.filter(r=>r.url==='/api/ramp/session').length,0);
  }finally{await f.close();}
});


test('dismissing native installation closes the invite and does not ask again',async()=>{
  const f=await fixture({installSeen:false,position:{tokens:25,valueUsd:25,availableUsd:0}});
  try{
    let prompts=0;
    const event=new window.Event('beforeinstallprompt',{cancelable:true});
    event.prompt=async()=>{prompts++;};event.userChoice=Promise.resolve({outcome:'dismissed'});
    await act(async()=>window.dispatchEvent(event));
    assert.equal(event.defaultPrevented,true);
    await f.signIn();assert.equal(prompts,0);
    await f.click('Add to Home Screen');assert.equal(prompts,1);
    assert.equal(document.querySelector('[aria-modal="true"]'),null);
    await act(async()=>globalThis.cfkWalletProps.onReady({...f.bridge,displayName:'Taylor'}));
    assert.doesNotMatch(f.text(),/Keep CFK close|Add to Home Screen/);
  }finally{await f.close();}
});

test('offline state labels stale prices and disables the buy action',async()=>{
  const f=await fixture({buyEnabled:true});
  try{
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    await act(async()=>window.dispatchEvent(new window.Event('offline')));
    assert.match(f.text(),/Displayed prices may be out of date/);
    assert.equal(document.querySelector('.trade-buttons .buy').disabled,true);
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
  }finally{await f.close();}
});


test('going offline while a sale review is open cannot sign the sale',async()=>{
  const f=await fixture({position:{tokens:40,valueUsd:40,availableUsd:12.34},responses:{'/api/trade/prepare':()=>({orderId:'sale',transaction:'unsigned-fixture',amountUsd:19.4,tokens:20,slippageBps:100})}});
  try{
    await f.signIn();await f.click('Sell');
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    await act(async()=>window.dispatchEvent(new window.Event('offline')));
    const confirm=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm sale');
    assert.equal(confirm.disabled,true);
    await act(async()=>confirm.click());
    assert.equal(f.signs(),0);
    assert.ok(!f.requests.some(r=>r.url==='/api/trade/submit'));
  }finally{await f.close();}
});


test('guest checkout continues after Buy without a sign-up screen or second Buy tap',async()=>{
  const f=await fixture({buyEnabled:true,guestCheckoutEnabled:true,responses:{
    '/api/ramp/preflight':()=>({ready:true}),
    '/api/ramp/session':()=>({rampId:'new-payment',providerName:'Fixture provider',checkoutUrl:'https://checkout.invalid/',grossCents:2000,platformFeeCents:300,providerFeeCents:100,netCents:1600})
  }});
  try{
    const buy=document.querySelector('.trade-buttons .buy');
    await act(async()=>buy.click());
    assert.equal(buy.disabled,true);
    assert.equal(globalThis.cfkWalletProps.loginMethod,'guest');
    assert.equal(document.querySelector('[aria-label="Mock secure sign-in"]'),null);
    assert.equal(f.requests.filter(r=>r.url==='/api/ramp/session').length,0);
    await act(async()=>globalThis.cfkWalletProps.onReady(f.bridge));
    const sessions=f.requests.filter(r=>r.url==='/api/ramp/session');
    assert.equal(sessions.length,1);
    assert.equal(JSON.parse(sessions[0].body).grossCents,2000);
    assert.match(f.text(),/Pay \$20.00 to buy CFK/);
    assert.equal(f.signs(),0);
  }finally{await f.close();}
});

test('a guest reaches payment first and saves their account only after a confirmed purchase',async()=>{
  let completed=false;
  const f=await fixture({buyEnabled:true,guestCheckoutEnabled:true,position:()=>({tokens:completed?40:0,valueUsd:completed?40:0,availableUsd:0}),responses:{
    '/api/ramp/preflight':()=>({ready:true}),
    '/api/ramp/session':()=>({rampId:'guest-payment',direction:'onramp',checkoutUrl:'https://checkout.invalid/',grossCents:5000,platformFeeCents:750,providerFeeCents:100,netCents:4150}),
    '/api/ramp/status?id=guest-payment':()=>({status:'completed',direction:'onramp'}),
    '/api/trade/prepare':()=>({orderId:'guest-buy',transaction:'unsigned-fixture'}),
    '/api/trade/submit':()=>({signature:'test-signature'}),
    '/api/trade/confirm':()=>{completed=true;return {confirmed:true,side:'buy',signature:'test-signature'};}
  }});
  try{
    assert.equal(globalThis.cfkWalletProps,undefined);
    await f.click('$50');await f.click('Buy $50 of CFK');
    assert.equal(globalThis.cfkWalletProps.loginMethod,'guest');
    await act(async()=>globalThis.cfkWalletProps.onReady({...f.bridge,isGuest:true}));
    assert.match(f.text(),/Pay \$50.00 to buy CFK/);
    assert.equal(document.querySelector('.save-account'),null);
    assert.equal(f.signs(),0);
    assert.equal(f.upgrades(),0);
    await f.click('Check payment');
    assert.match(f.text(),/Your CFK is yours/);
    assert.equal(f.signs(),1);
    assert.equal(localStorage.getItem('cfk_pending'),null);
    await f.click('Save my account');
    assert.equal(f.upgrades(),1);
    await act(async()=>globalThis.cfkWalletProps.onError('The email connection was interrupted.'));
    await f.click('Try again');
    assert.equal(f.upgrades(),2);
    await act(async()=>globalThis.cfkWalletProps.onReady({...f.bridge,isGuest:false}));
    assert.equal(document.querySelector('.save-account'),null);
    assert.equal(f.requests.filter(r=>r.url==='/api/ramp/session').length,1);
  }finally{await f.close();}
});

test('disabled guest checkout creates no identity, wallet or payment session',async()=>{
  const f=await fixture({buyEnabled:true,guestCheckoutEnabled:false});
  try{
    await f.click('Buy $20 of CFK');
    assert.match(f.text(),/Guest checkout is not available yet/);
    assert.equal(globalThis.cfkWalletProps,undefined);
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
  }finally{await f.close();}
});

test('a provider-rejected guest login cannot reach funding or create a payment',async()=>{
  const f=await fixture({buyEnabled:true,guestCheckoutEnabled:true});
  try{
    await f.click('Buy $20 of CFK');
    await act(async()=>globalThis.cfkWalletProps.onError('Guest checkout could not connect. No payment has been taken. Please try again.'));
    assert.match(f.text(),/No payment has been taken/);
    assert.equal(f.signs(),0);
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
    assert.equal(localStorage.getItem('cfk_pending'),null);
    await act(async()=>document.querySelector('[aria-label="Close"]').click());
    assert.equal(sessionStorage.getItem('cfk_purchase_intent'),null);
    assert.equal(document.querySelector('[aria-modal="true"]'),null);
  }finally{await f.close();}
});

test('refreshing a checkout intent keeps its amount but waits for another Buy tap',async()=>{
  const f=await fixture({buyEnabled:true,guestCheckoutEnabled:true,purchaseIntent:{side:'buy',amountUsd:37.25,savedAt:Date.now()},responses:{
    '/api/ramp/preflight':()=>({ready:true}),
    '/api/ramp/session':()=>({rampId:'resumed',direction:'onramp',checkoutUrl:'https://checkout.invalid/',grossCents:3725})
  }});
  try{
    assert.equal(globalThis.cfkWalletProps,undefined);
    assert.equal(document.querySelector('[aria-modal="true"]'),null);
    assert.equal(f.requests.filter(r=>/ramp|trade/.test(r.url)).length,0);
    await f.click('Buy $37.25 of CFK');
    assert.equal(globalThis.cfkWalletProps.loginMethod,'guest');
    await act(async()=>globalThis.cfkWalletProps.onReady(f.bridge));
    const requests=f.requests.filter(r=>r.url==='/api/ramp/session');
    assert.equal(requests.length,1);
    assert.equal(JSON.parse(requests[0].body).grossCents,3725);
    assert.equal(sessionStorage.getItem('cfk_purchase_intent'),null);
  }finally{await f.close();}
});

test('restoring an account leaves an unfinished payment closed until Continue is tapped',async()=>{
  const f=await fixture({pending:{type:'payment',rampId:'saved-payment',userId:'test-user'},responses:{
    '/api/ramp/status?id=saved-payment':()=>({status:'pending',direction:'onramp'})
  }});
  try{
    await f.signIn();
    assert.equal(document.querySelector('[aria-modal="true"]'),null);
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
    await f.click('Continue payment or trade');
    assert.ok(f.requests.some(r=>r.url==='/api/ramp/status?id=saved-payment'));
    assert.ok(document.querySelector('[aria-modal="true"]'));
  }finally{await f.close();}
});

test('a smaller position can be sold without being rejected by the default $20 buy amount',async()=>{
  const f=await fixture({position:{tokens:5,valueUsd:5.75,availableUsd:1},responses:{'/api/trade/prepare':()=>({orderId:'small-sale',transaction:'unsigned',amountUsd:5.6,tokens:5,slippageBps:100})}});
  try{
    await f.signIn();await f.click('Sell');
    const request=f.requests.find(r=>r.url==='/api/trade/prepare');
    assert.equal(JSON.parse(request.body).amountUsd,5.75);
    assert.match(f.text(),/Review sale/);
    assert.equal(f.signs(),0);
  }finally{await f.close();}
});


test('CFK Card stays a locked preview before selling and never starts payment or authentication',async()=>{
  const f=await fixture({buyEnabled:true});
  try{
    const card=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='CFK Card, locked preview');
    await act(async()=>card.click());
    assert.match(f.text(),/Meet CFK Card/);
    assert.match(document.querySelector('.cash-card-page').textContent,/Unlock after your first sale/);
    assert.equal(document.querySelector('.trade-dock'),null);
    assert.equal(globalThis.cfkWalletProps,undefined);
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
    await f.click('Back to CFK');
    assert.ok(document.querySelector('.trade-dock'));
    assert.equal(document.querySelector('.dock-fee-note'),null);
  }finally{await f.close();}
});

test('a confirmed sale unlocks only the setup stage, never a fake active card balance',async()=>{
  const f=await fixture({responses:{'/api/account/history':()=>({hasCompletedSale:true,items:[]})}});
  try{
    await f.signIn();
    await act(async()=>document.querySelector('.account-navigation button[aria-label="CFK Card"]').click());
    assert.match(document.querySelector('.cash-card-page').textContent,/Your first sale is complete/);
    assert.match(document.querySelector('.cash-card-page').textContent,/Not activated/);
    assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Activation coming soon').disabled,true);
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
    await act(async()=>globalThis.cfkWalletProps.onReady({...f.bridge,userId:'second-user',displayName:'Sam'}));
    assert.equal(document.querySelector('.cash-card-page'),null);
    assert.match(document.querySelector('.account-welcome').textContent,/Hello, Sam/);
  }finally{await f.close();}
});

test('the saved profile name is greeted without adding a step to checkout',async()=>{
  const f=await fixture();
  try{
    f.bridge.displayName='Jordan';await f.signIn();
    assert.match(document.querySelector('.account-welcome').textContent,/Hello, Jordan/);
    assert.ok(!f.requests.some(r=>/ramp|trade|profile/.test(r.url)));
    await act(async()=>document.querySelector('[aria-label="Edit your name"]').click());
    assert.equal(document.querySelector('#display-name').value,'Jordan');
    await f.click('Maybe later');
    assert.equal(document.querySelector('#display-name'),null);
  }finally{await f.close();}
});

test('install invite waits for a funded saved account, then stays dismissed',async()=>{
  const f=await fixture({installSeen:false,position:{tokens:25,valueUsd:25,availableUsd:0}});
  try{
    assert.doesNotMatch(f.text(),/Allow ad measurement|Add to Home Screen/);
    assert.equal(document.querySelector('footer .install-button'),null);
    f.bridge.isGuest=true;f.bridge.needsEmail=true;
    await f.signIn();
    assert.doesNotMatch(f.text(),/Keep CFK close/);
    await act(async()=>globalThis.cfkWalletProps.onReady({...f.bridge,isGuest:false,needsEmail:false}));
    assert.match(document.querySelector('[aria-modal="true"]').textContent,/Keep CFK close/);
    await f.click('Add to Home Screen');
    assert.match(document.querySelector('.install-help').textContent,/Install app.*bookmark/);
    await f.click('Got it');
    assert.equal(document.querySelector('[aria-modal="true"]'),null);
    assert.equal(localStorage.getItem('cfk_install_seen:test-user'),'1');
    await act(async()=>globalThis.cfkWalletProps.onReady({...f.bridge,isGuest:false,needsEmail:false,displayName:'Taylor'}));
    assert.doesNotMatch(f.text(),/Keep CFK close/);
    assert.equal(f.signs(),0);
    assert.ok(!f.requests.some(r=>/ramp|trade/.test(r.url)));
  }finally{await f.close();}
});

test('unfunded and already installed accounts never receive an install invite',async()=>{
  for(const options of [{installSeen:false},{installSeen:false,standalone:true,position:{tokens:25,valueUsd:25,availableUsd:0}}]){
    const f=await fixture(options);
    try{await f.signIn();assert.doesNotMatch(f.text(),/Keep CFK close|Add to Home Screen/);assert.equal(localStorage.getItem('cfk_install_seen:test-user'),null);}
    finally{await f.close();}
  }
});

test('saved install dismissal survives a new app mount',async()=>{
  const f=await fixture({installSeen:true,position:{tokens:25,valueUsd:25,availableUsd:0}});
  try{await f.signIn();assert.doesNotMatch(f.text(),/Keep CFK close|Add to Home Screen/);}finally{await f.close();}
});

test('install invite waits for payment recovery and native installation needs a click',async()=>{
  const f=await fixture({installSeen:false,pending:{type:'payment',rampId:'pending-install',userId:'test-user',savedAt:Date.now()},position:{tokens:25,valueUsd:25,availableUsd:0},responses:{'/api/ramp/status?id=pending-install':()=>({status:'pending',direction:'onramp'})}});
  try{
    await f.signIn();
    assert.doesNotMatch(f.text(),/Keep CFK close/);
    assert.equal(localStorage.getItem('cfk_install_seen:test-user'),null);
  }finally{await f.close();}
  const ready=await fixture({installSeen:false,position:{tokens:25,valueUsd:25,availableUsd:0}});
  try{
    let prompts=0;
    const event=new ready.dom.window.Event('beforeinstallprompt',{cancelable:true});
    event.prompt=async()=>{prompts++;};event.userChoice=Promise.resolve({outcome:'accepted'});
    await act(async()=>ready.dom.window.dispatchEvent(event));
    assert.equal(event.defaultPrevented,true);
    await ready.signIn();assert.equal(prompts,0);
    await ready.click('Add to Home Screen');assert.equal(prompts,1);
    assert.equal(document.querySelector('[aria-modal="true"]'),null);
  }finally{await ready.close();}
});

test('a newly funded account waits for the current dialog to close before the invite',async()=>{
  let funded=false;
  const f=await fixture({installSeen:false,position:()=>({tokens:funded?25:0,valueUsd:funded?25:0,availableUsd:0})});
  try{
    await f.signIn();await f.click('Add your name');
    funded=true;
    await act(async()=>globalThis.cfkWalletProps.onReady({...f.bridge,address:'funded-wallet'}));
    assert.match(document.querySelector('[aria-modal="true"]').textContent,/Make it yours/);
    assert.doesNotMatch(f.text(),/Keep CFK close/);
    assert.equal(localStorage.getItem('cfk_install_seen:test-user'),null);
    await f.click('Maybe later');
    assert.match(document.querySelector('[aria-modal="true"]').textContent,/Keep CFK close/);
    await f.click('Not now');
    assert.equal(document.querySelector('[aria-modal="true"]'),null);
  }finally{await f.close();}
});
