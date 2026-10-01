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
  b.onLoad({filter:/.*/,namespace:'ui-fixture'},args=>({loader:'jsx',contents:args.path.endsWith('Wallet.jsx')?`import React from 'react'; export default function Wallet(props){globalThis.cfkWalletProps=props;return <div role="dialog" aria-label="Mock secure sign-in">Mock secure sign-in</div>;}`:`export default function Fixture(){return null;}`}));
  b.onResolve({filter:/\/tracking\.js$/},()=>({path:'tracking',namespace:'tracking-fixture'}));
  b.onLoad({filter:/.*/,namespace:'tracking-fixture'},()=>({contents:`export const captureAttribution=()=>{},getSession=async()=>({id:'test-session'}),track=async()=>{},setConsent=()=>{},getConsent=()=>'denied';`}));
}}]});
const {default:App}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
async function fixture({pending,buyEnabled=false,withdrawEnabled=false,position={tokens:0,valueUsd:0,availableUsd:0},responses={}}={}){
  const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/'});
  const originals=new Map();
  for(const [key,value] of Object.entries({window:dom.window,navigator:dom.window.navigator,document:dom.window.document,sessionStorage:dom.window.sessionStorage,localStorage:dom.window.localStorage,location:dom.window.location,ResizeObserver:class{observe(){}disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  if(pending)dom.window.localStorage.setItem('cfk_pending',JSON.stringify(pending));
  const requests=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    requests.push({url,...options});
    let result;
    if(url==='/api/config')result={privyAppId:'test-privy-app',checkout:{buyEnabled,withdrawEnabled}};
    else if(url==='/api/market')result={priceUsd:1};
    else if(url==='/api/activity')result={items:[]};
    else if(url.startsWith('/api/chart'))result={points:[]};
    else if(url.startsWith('/api/position'))result=position;
    else if(url==='/api/account/history'&&!responses[url])result={items:[]};
    else if(responses[url])result=await responses[url](options);
    else throw new Error('Unexpected isolated request: '+url);
    return new Response(JSON.stringify(result.body??result),{status:result.status??200,headers:{'Content-Type':'application/json'}});
  };
  const root=createRoot(dom.window.document.getElementById('root'));
  await act(async()=>root.render(React.createElement(App)));
  const buttons=()=>[...document.querySelectorAll('button')];
  const click=async text=>{const button=buttons().find(b=>b.textContent===text);assert.ok(button,`Missing button: ${text}`);assert.equal(button.disabled,false);await act(async()=>button.click());};
  let signs=0;
  const bridge={userId:'test-user',address:'test-wallet',getAccessToken:async()=>'test-token',sign:async()=>{signs++;return 'signed-fixture';}};
  return {dom,requests,click,bridge,signs:()=>signs,text:()=>document.body.textContent,signIn:async()=>{await click('Sign in to your account');await act(async()=>globalThis.cfkWalletProps.onReady(bridge));},close:async()=>{await act(async()=>root.unmount());globalThis.fetch=originalFetch;delete globalThis.cfkWalletProps;for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}dom.window.close();}};
}

test('returning users can sign in without starting a buy; provider gets an unobstructed dialog',async()=>{
  const f=await fixture({buyEnabled:false});
  try{
    assert.equal(globalThis.cfkWalletProps,undefined);
    await f.click('Sign in to your account');
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


test('home-screen help is optional and an install prompt only runs after a tap',async()=>{
  const f=await fixture();
  try{
    assert.equal(document.querySelector('.install-help'),null);
    await f.click('Add to Home Screen');
    assert.match(document.querySelector('.install-help').textContent,/internet connection is required/);
    await f.click('Got it');
    let prompts=0;
    const event=new window.Event('beforeinstallprompt',{cancelable:true});
    event.prompt=async()=>{prompts++;};event.userChoice=Promise.resolve({outcome:'dismissed'});
    await act(async()=>window.dispatchEvent(event));
    assert.equal(event.defaultPrevented,true);
    assert.equal(prompts,0);
    await f.click('Add to Home Screen');
    assert.equal(prompts,1);
    assert.ok([...document.querySelectorAll('button')].some(b=>b.textContent==='Add to Home Screen'));
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


test('signing in resumes the selected buy once without a second Buy tap',async()=>{
  const f=await fixture({buyEnabled:true,responses:{
    '/api/ramp/preflight':()=>({ready:true}),
    '/api/ramp/session':()=>({rampId:'new-payment',providerName:'Fixture provider',checkoutUrl:'https://checkout.invalid/',grossCents:2000,platformFeeCents:300,providerFeeCents:100,netCents:1600})
  }});
  try{
    const buy=document.querySelector('.trade-buttons .buy');
    await act(async()=>buy.click());
    assert.equal(buy.disabled,true);
    assert.equal(f.requests.filter(r=>r.url==='/api/ramp/session').length,0);
    await act(async()=>globalThis.cfkWalletProps.onReady(f.bridge));
    const sessions=f.requests.filter(r=>r.url==='/api/ramp/session');
    assert.equal(sessions.length,1);
    assert.equal(JSON.parse(sessions[0].body).grossCents,2000);
    assert.match(f.text(),/Pay \$20.00 to buy CFK/);
    assert.equal(f.signs(),0);
  }finally{await f.close();}
});
