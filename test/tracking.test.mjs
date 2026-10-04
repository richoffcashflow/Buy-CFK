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
    if(url==='/api/session')return new Response(JSON.stringify({id:sessionId,consent:true}),{status:200});
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

async function measurementFixture({saved,serverConsent=true}={}){
  const values=new Map(saved?[['cfk_consent',saved]]:[]),requests=[],pixels=[];
  const originals=new Map();
  const globals={navigator:{globalPrivacyControl:false},localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},location:{origin:'https://buycfk.com',pathname:'/',search:'?utm_source=campaign'},document:{cookie:'',head:{appendChild(){}},createElement:()=>({})},window:{fbq:(...args)=>pixels.push(args)}};
  for(const [key,value] of Object.entries(globals)){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
  const originalFetch=globalThis.fetch;
  let holdEvent=null;
  globalThis.fetch=async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    if(url==='/api/events'&&holdEvent)await holdEvent;
    return new Response(JSON.stringify(url==='/api/session'?{id:'d'.repeat(32),consent:serverConsent}:{accepted:true}),{status:200});
  };
  const tracking=await import('../src/tracking.js?test='+crypto.randomUUID());
  const config={mint:'CFK',tracking:{},measurement:{defaultEnabled:true,privacySignal:false}};
  return {...tracking,config,values,requests,pixels,hold:promise=>{holdEvent=promise;},close:()=>{globalThis.fetch=originalFetch;for(const [key,d] of originals){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}}};
}

test('US measurement starts without a popup or recording a fabricated opt-in',async()=>{
  const f=await measurementFixture();
  try{
    assert.equal(f.getConsent(),'unknown');
    f.configureMeasurement(f.config);
    assert.equal(f.getConsent(),'granted');
    await f.track('ViewContent',{trigger:'coin_page'},f.config);
    assert.equal(f.values.has('cfk_consent'),false);
    assert.equal(f.requests[0].body.consent,'default');
    assert.equal(f.requests[0].body.attribution.utm_source,'campaign');
    assert.equal(f.pixels.filter(a=>a[0]==='track').length,1);
    f.configureMeasurement({...f.config,measurement:{defaultEnabled:false}});
    assert.equal(f.getConsent(),'unknown');
    assert.equal(f.values.has('cfk_attribution'),false);
  }finally{f.close();}
});

test('saved opt-outs, browser GPC, and server refusal prevent advertising events',async()=>{
  for(const kind of ['saved','browser','server']){
    const f=await measurementFixture({saved:kind==='saved'?'denied':undefined,serverConsent:kind!=='server'});
    try{
      f.configureMeasurement(f.config);
      if(kind==='browser')navigator.globalPrivacyControl=true;
      await f.track('ViewContent',{trigger:'coin_page'},f.config);
      assert.equal(f.requests.filter(r=>r.url==='/api/events').length,0);
      assert.equal(f.pixels.length,0);
    }finally{f.close();}
  }
});

test('turning measurement off during delivery prevents late browser pixels',async()=>{
  const f=await measurementFixture();
  try{
    f.configureMeasurement(f.config);
    let release;f.hold(new Promise(resolve=>{release=resolve;}));
    const tracking=f.track('ViewContent',{trigger:'coin_page'},f.config);
    while(!f.requests.some(r=>r.url==='/api/events'))await new Promise(resolve=>setTimeout(resolve,0));
    f.setConsent('denied');await f.getSession();release();await tracking;
    assert.equal(f.pixels.filter(a=>a[0]==='track').length,0);
    assert.equal(f.requests.filter(r=>r.url==='/api/session').at(-1).body.consent,'denied');
    assert.equal(f.values.has('cfk_attribution'),false);
  }finally{f.close();}
});
