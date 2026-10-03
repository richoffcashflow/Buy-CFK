import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/utils.js';
import {validAmount,readPurchaseIntent,PURCHASE_INTENT_KEY} from '../src/purchase-intent.js';
import {allowedRequestOrigin} from '../server/request-origin.mjs';
import {guestCheckoutReady} from '../server/guest-checkout.mjs';

test('custom amounts reject non-finite values, sub-cent precision and oversized purchases',()=>{
  for(const value of ['0.01','20','37.25','1000000'])assert.equal(validAmount(value),true);
  for(const value of ['','0','-5','0.001','20.123','1e3','Infinity','1000000.01'])assert.equal(validAmount(value),false);
});
test('only a recent explicit buy survives an authentication redirect',()=>{
  const now=Date.now(),store={value:null,get(){return this.value;},remove(){this.value=null;}};
  const action={side:'buy',amountUsd:37.25,savedAt:now-1000};
  store.value=JSON.stringify(action);assert.deepEqual(readPurchaseIntent(store,now),action);
  for(const invalid of [{...action,side:'sell'},{...action,savedAt:now-600001},{...action,savedAt:now+1000},{...action,amountUsd:1e12}]){
    store.value=JSON.stringify(invalid);assert.equal(readPurchaseIntent(store,now),null);assert.equal(store.value,null);
  }
  assert.equal(PURCHASE_INTENT_KEY,'cfk_purchase_intent');
});
test('verified website aliases work without accepting attacker origins or arbitrary previews',()=>{
  for(const origin of ['https://buycfk.com','https://www.buycfk.com','https://buy-cfk.vercel.app'])assert.equal(allowedRequestOrigin(origin,'https://buy-cfk.vercel.app'),true);
  for(const origin of ['https://buycfk.com.evil.test','http://buycfk.com','https://evil.test','null','https://some-preview.vercel.app'])assert.equal(allowedRequestOrigin(origin,'https://buy-cfk.vercel.app'),false);
  assert.equal(allowedRequestOrigin('https://buycfk.com','https://sandbox.invalid'),false);
  assert.equal(allowedRequestOrigin('https://sandbox.invalid','https://sandbox.invalid'),true);
});
test('guest checkout is offered only when both guest and email recovery are enabled',async()=>{
  assert.equal(await guestCheckoutReady(null),false);
  for(const [index,config] of [{guest_auth:false,email_auth:true},{guest_auth:true,email_auth:false},{guest_auth:true,email_auth:true}].entries()){
    assert.equal(await guestCheckoutReady('test-app-'+index,async()=>new Response(JSON.stringify(config))),index===2);
  }
  assert.equal(await guestCheckoutReady('unavailable',async()=>{throw new Error('offline');}),false);
});
test('a stalled checkout times out without retrying or claiming the payment failed',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));};
  try{await assert.rejects(api('/ramp/session',{method:'POST',body:{checkoutId:'same-attempt'},timeoutMs:10}),/saved payment will be checked/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('an HTML outage response is never treated as a successful payment',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response('<html>Unavailable</html>');
  try{await assert.rejects(api('/ramp/session'),/incomplete response/);}finally{globalThis.fetch=original;}
});
