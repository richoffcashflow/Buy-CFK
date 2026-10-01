import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {Keypair} from '@solana/web3.js';
import {createRamp,rampStatus} from '../server/ramp.mjs';

// Lightweight isolated database/protocol fixture. It exercises the production
// orchestration and transaction-lock protocol without starting WASM or a server.
test('generic adapter preserves one payment identity through timeout, concurrency and terminal retries',async()=>{
  const env={DATABASE_URL:'postgres://test-only',RAMP_ENABLED:'true',TRADING_ENABLED:'true',STRIPE_ONRAMP_ENABLED:'false',RAMP_ADAPTER_URL:'https://adapter.invalid',RAMP_ADAPTER_KEY:'fixture-only-key',RAMP_WEBHOOK_SECRET:'fixture-only-secret',RAMP_ALLOWED_ORIGINS:'https://checkout.invalid',APP_URL:'https://app.invalid',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_PUBLISHABLE_KEY:'pk_test_fixture',STRIPE_ONRAMP_WEBHOOK_SECRET:'whsec_fixture',PLATFORM_FEE_WALLET:Keypair.generate().publicKey.toBase58()};
  const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  const oldQuery=pg.Pool.prototype.query,oldConnect=pg.Pool.prototype.connect,oldFetch=globalThis.fetch;
  const rows=new Map(),locks=new Map(),calls=[];
  const clone=value=>structuredClone(value);
  const sessionId='a'.repeat(32),user={id:'fixture-user'},wallet='1'.repeat(32),checkoutId='12345678-1234-1234-1234-123456789abc';
  let mode='timeout';
  async function query(sql,args){
    if(sql.startsWith('SELECT * FROM cfk_sessions'))return {rows:[{id:sessionId,expires_at:new Date(Date.now()+86400000)}]};
    if(sql.startsWith('SELECT * FROM cfk_ramps WHERE user_id='))return {rows:[...rows.values()].filter(r=>r.user_id===args[0]&&r.checkout_id===args[1]).map(clone).slice(0,2)};
    if(sql.startsWith('SELECT * FROM cfk_ramps WHERE id=')){const row=rows.get(args[0]);return {rows:row&&(!args[1]||row.user_id===args[1])?[clone(row)]:[]};}
    if(sql.startsWith('INSERT INTO cfk_ramps')){
      const [id,user_id,wallet,direction,session_id,gross_cents,platform_fee_cents,net_cents,checkout_id,quote]=args;
      const row={id,user_id,wallet,direction,session_id,gross_cents,platform_fee_cents,net_cents,checkout_id,quote,provider_id:null,provider_fee_cents:0,status:'created',created_at:new Date()};rows.set(id,clone(row));return {rows:[clone(row)]};
    }
    if(sql.startsWith('UPDATE cfk_ramps SET provider_id=')){
      const [id,provider_id,provider_fee_cents,net_cents,quote]=args,row=rows.get(id);
      if(row.status!=='created'||row.provider_id&&row.provider_id!==provider_id)return {rows:[]};
      Object.assign(row,{provider_id,provider_fee_cents,net_cents,quote,status:'pending'});return {rows:[clone(row)]};
    }
    throw new Error('Unexpected fixture query: '+sql);
  }
  pg.Pool.prototype.query=query;
  pg.Pool.prototype.connect=async()=>{
    let release;
    return {query:async(sql,args)=>{
      if(sql==='BEGIN')return {rows:[]};
      if(sql==='COMMIT'||sql==='ROLLBACK'){release?.();release=null;return {rows:[]};}
      if(sql.includes('pg_advisory_xact_lock')){
        const before=locks.get(args[0])||Promise.resolve();let unlock;
        const next=new Promise(resolve=>{unlock=resolve;});locks.set(args[0],before.then(()=>next));await before;release=unlock;return {rows:[]};
      }
      return query(sql,args);
    },release(){release?.();}};
  };
  globalThis.fetch=async(url,options)=>{
    assert.ok(url.startsWith('https://adapter.invalid/sessions'));
    if(options.method==='GET')return new Response(JSON.stringify({status:'pending'}));
    const body=JSON.parse(options.body);calls.push(body);
    const saved=rows.get(body.merchantReference);assert.ok(saved,'merchant identity must be persisted before the provider call');
    assert.equal(saved.quote.request.idempotencyKey,body.idempotencyKey);
    if(mode==='timeout')throw new Error('Simulated uncertain timeout');
    return new Response(JSON.stringify({id:'provider_'+body.idempotencyKey,checkoutUrl:'https://checkout.invalid/'+body.idempotencyKey,embeddable:true,grossCents:body.grossCents,platformFeeCents:body.platformFeeCents,providerFeeCents:100,netCents:body.grossCents-body.platformFeeCents-100}));
  };
  const body={wallet,direction:'onramp',intent:'buy',grossCents:2000,sessionId,checkoutId};
  try{
    await assert.rejects(createRamp(user,body),/uncertain timeout/);
    assert.equal(rows.size,1);const first=[...rows.values()][0];
    mode='success';process.env.APP_URL='https://changed-app.invalid';
    const [one,two]=await Promise.all([createRamp(user,body),createRamp(user,body)]);
    assert.equal(rows.size,1);assert.equal(one.rampId,first.id);assert.equal(two.rampId,first.id);
    assert.ok(calls.every(c=>c.idempotencyKey===first.id&&c.merchantReference===first.id));
    assert.ok(calls.every(c=>c.returnUrl==='https://app.invalid'&&c.webhookUrl==='https://app.invalid/api/ramp/webhook'));
    assert.equal(one.netCents,1600);assert.equal(one.platformFeeCents,300);
    const before=calls.length;assert.deepEqual(await createRamp(user,body),one);assert.equal(calls.length,before);
    const restored=await rampStatus(user,first.id);assert.equal(restored.checkoutUrl,one.checkoutUrl);assert.equal(restored.status,'pending');
    await assert.rejects(rampStatus({id:'other'},first.id),{status:404});
    for(const change of [{grossCents:3000},{wallet:'2'.repeat(32)},{intent:'withdraw'}])await assert.rejects(createRamp(user,{...body,...change}),{status:409});
    assert.equal(calls.length,before);
    process.env.RAMP_ADAPTER_URL='https://changed-adapter.invalid';await assert.rejects(createRamp(user,body),{status:409});process.env.RAMP_ADAPTER_URL=env.RAMP_ADAPTER_URL;
    process.env.STRIPE_ONRAMP_ENABLED='true';await assert.rejects(createRamp(user,body),{status:409});process.env.STRIPE_ONRAMP_ENABLED='false';
    assert.equal(calls.length,before);
    rows.get(first.id).status='completed';const terminal=await createRamp(user,body);assert.equal(terminal.existingPayment,true);assert.equal(terminal.rampId,first.id);assert.equal(calls.length,before);
    const other=await createRamp({id:'other'},body);assert.notEqual(other.rampId,first.id);assert.equal(rows.size,2);
    rows.set('legacy-duplicate',{...clone(rows.get(first.id)),id:'legacy-duplicate'});
    const beforeDuplicate=calls.length;await assert.rejects(createRamp(user,body),{status:409});assert.equal(calls.length,beforeDuplicate);
  }finally{
    pg.Pool.prototype.query=oldQuery;pg.Pool.prototype.connect=oldConnect;globalThis.fetch=oldFetch;
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
