import test from 'node:test';
import assert from 'node:assert/strict';

test('checkout status polling emits one event, and a failed delivery can be retried',async()=>{
  const sessionId='a'.repeat(32),storage=new Map([['cfk_consent','granted']]);
  const pixel=[],events=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{globalPrivacyControl:false}});
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  globalThis.location={origin:'https://buycfk.com',pathname:'/',search:''};
  globalThis.document={cookie:'',head:{appendChild(){}},createElement:()=>({})};
  globalThis.window={fbq:(...args)=>pixel.push(args)};
  const originalFetch=globalThis.fetch;
  let failOnce=false;
  globalThis.fetch=async(url,options)=>{
    if(url==='/api/session')return new Response(JSON.stringify({id:sessionId}),{status:200});
    if(url==='/api/events'){
      const body=JSON.parse(options.body);events.push(body);
      await new Promise(resolve=>setTimeout(resolve,15));
      if(failOnce){failOnce=false;return new Response(JSON.stringify({message:'Temporary error'}),{status:503});}
      return new Response(JSON.stringify({accepted:true}),{status:200});
    }
    throw new Error('Unexpected request '+url);
  };
  try{
    const {track}=await import('../src/tracking.js');
    const config={mint:'CFK_MINT',tracking:{}};
    const details={trigger:'payment_ready',checkoutId:'b'.repeat(8)+'-bbbb-4bbb-8bbb-'+'b'.repeat(12)};
    await Promise.all([track('InitiateCheckout',details,config),track('InitiateCheckout',details,config),track('InitiateCheckout',details,config)]);
    assert.equal(events.length,1);
    assert.equal(pixel.filter(([kind,name])=>kind==='track'&&name==='InitiateCheckout').length,1);
    await track('InitiateCheckout',details,config);
    assert.equal(events.length,1);
    failOnce=true;
    const retry={...details,checkoutId:'c'.repeat(8)+'-cccc-4ccc-8ccc-'+'c'.repeat(12)};
    await assert.rejects(track('InitiateCheckout',retry,config),/Temporary error/);
    await track('InitiateCheckout',retry,config);
    assert.equal(events.length,3);
    assert.equal(pixel.filter(([kind,name])=>kind==='track'&&name==='InitiateCheckout').length,2);
    assert.ok(events.every(e=>e.name==='InitiateCheckout'&&e.trigger==='payment_ready'));
  }finally{globalThis.fetch=originalFetch;}
});
