import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {Keypair} from '@solana/web3.js';
import {stripeFundingReceipt,verifyStripeSignature,decimalUnits,createStripeRamp,reconcileStripeRamp} from '../server/stripe-payments.mjs';
import {rampStatus} from '../server/ramp.mjs';
const wallet=Keypair.generate().publicKey.toBase58(),recipient=Keypair.generate().publicKey.toBase58();
const makeData=row=>({id:row.provider_id,object:'crypto.onramp_session',livemode:true,status:'fulfillment_complete',metadata:{cfk_ramp_id:row.id,cfk_wallet:row.wallet},client_secret:row.provider_id+'_secret_TESTONLY',transaction_details:{lock_wallet_address:true,wallet_address:row.wallet,wallet_addresses:{solana:row.wallet},destination_currency:'sol',destination_network:'solana',source_currency:'usd',source_amount:'18.00',destination_amount:'0.18',fees:{network_fee_amount:'0.10',transaction_fee_amount:'1.90'},transaction_id:'4'.repeat(64)}});

test('Stripe signatures require an authentic recent raw payload, and support rotated signatures',()=>{
  const raw='{"data":{"object":{}}}',t='1790000000',secret='whsec_TESTONLY';
  const digest=createHmac('sha256',secret).update(t+'.'+raw).digest('hex'),header=`t=${t},v1=${digest}`;
  assert.equal(verifyStripeSignature(raw,header,secret,Number(t)*1000),true);
  assert.equal(verifyStripeSignature(raw,header+',v1='+'0'.repeat(64),secret,Number(t)*1000),true);
  assert.equal(verifyStripeSignature(raw+' ',header,secret,Number(t)*1000),false);
  assert.equal(verifyStripeSignature(raw,header,secret,(Number(t)+301)*1000),false);
  assert.equal(verifyStripeSignature(raw,header+',t='+t,secret,Number(t)*1000),false);
  assert.equal(verifyStripeSignature(raw,header,'',Number(t)*1000),false);
});
test('actual Stripe receipts determine 15% fees; changed wallets, currencies, and precision are rejected',()=>{
  const previous=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY='sk_live_TESTONLY';
  try{
    const row={id:randomUUID(),provider_id:'cos_TESTONLY',wallet,quote:{feeRecipient:recipient}};
    const data=makeData(row),receipt=stripeFundingReceipt(data,row);
    assert.equal(receipt.grossCents,2000);assert.equal(receipt.providerFeeCents,200);assert.equal(receipt.platformFeeCents,300);assert.equal(receipt.netCents,1500);assert.equal(receipt.feeLamports,'30000000');
    for(const patch of [{wallet_address:recipient},{source_currency:'eur'},{destination_currency:'usdc'},{lock_wallet_address:false},{source_amount:'18.001'}])assert.throws(()=>stripeFundingReceipt({...data,transaction_details:{...data.transaction_details,...patch}},row));
    assert.throws(()=>stripeFundingReceipt({...data,livemode:false},row));
    assert.equal(stripeFundingReceipt({...data,status:'requires_payment'},row),null);
    assert.equal(decimalUnits('0.180000000000000000',9),180000000n);assert.throws(()=>decimalUnits('0.1800000001',9));
  }finally{if(previous===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previous;}
});
test('Stripe retries share one checkout, funding needs finalized delivery, and duplicate settlement cannot mint credit',async()=>{
  const db=new PGlite();await db.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
  const names=['DATABASE_URL','STRIPE_SECRET_KEY','STRIPE_PUBLISHABLE_KEY','STRIPE_ONRAMP_ENABLED','STRIPE_ONRAMP_WEBHOOK_SECRET','TRADING_ENABLED','PLATFORM_FEE_WALLET'];
  const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{DATABASE_URL:'postgres://test-only',STRIPE_SECRET_KEY:'sk_live_TESTONLY',STRIPE_PUBLISHABLE_KEY:'pk_live_TESTONLY',STRIPE_ONRAMP_ENABLED:'true',STRIPE_ONRAMP_WEBHOOK_SECRET:'whsec_TESTONLY',TRADING_ENABLED:'true',PLATFORM_FEE_WALLET:recipient});
  const realQuery=pg.Pool.prototype.query,realConnect=pg.Pool.prototype.connect,realFetch=globalThis.fetch;
  const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args);
  pg.Pool.prototype.query=query;pg.Pool.prototype.connect=async()=>({query,release(){}});
  const session='b'.repeat(32),user={id:'stripe-user'},body={wallet,direction:'onramp',intent:'buy',grossCents:2000,checkoutId:randomUUID(),sessionId:session};
  let data,posts=0,settled=false;
  globalThis.fetch=async(url,options)=>{
    let result;
    if(url.startsWith('https://api.stripe.com')){
      if(url.includes('onramp_quotes'))result={livemode:true,source_currency:'usd',source_amount:'18.00',destination_network_quotes:{solana:[{destination_currency:'sol',destination_network:'solana',destination_amount:'0.18',source_total_amount:'20.00'}]}};
      else if(options.method==='POST'){
        posts++;const params=new URLSearchParams(options.body);
        assert.equal(params.get('lock_wallet_address'),'true');assert.equal(params.get('wallet_addresses[solana]'),wallet);
        assert.equal(options.headers['Idempotency-Key'],'cfk_'+params.get('metadata[cfk_ramp_id]'));
        data=makeData({id:params.get('metadata[cfk_ramp_id]'),provider_id:'cos_TESTONLY',wallet});data.status='requires_payment';result=data;
      }else result=data;
    }else result={jsonrpc:'2.0',result:settled?{transaction:{message:{accountKeys:[wallet]}},meta:{err:null,preBalances:[0],postBalances:[180000000]}}:null};
    return new Response(JSON.stringify(result),{status:200});
  };
  try{
    await db.query('INSERT INTO cfk_sessions(id,source_url) VALUES($1,$2)',[session,'https://example.com']);
    const checkout=await createStripeRamp(user,body),again=await createStripeRamp(user,body);
    assert.equal(checkout.rampId,again.rampId);assert.equal(posts,1);assert.ok(checkout.clientSecret);
    await assert.rejects(createStripeRamp(user,{...body,grossCents:5000}),{status:409});
    await assert.rejects(rampStatus({id:'other-user'},checkout.rampId),{status:404});
    let row=(await db.query('SELECT * FROM cfk_ramps WHERE id=$1',[checkout.rampId])).rows[0];
    assert.equal(row.quote.clientSecret,undefined);
    assert.equal((await reconcileStripeRamp(row)).status,'pending');
    data.status='fulfillment_complete';assert.equal((await reconcileStripeRamp(row)).status,'pending');
    assert.equal((await db.query('SELECT * FROM cfk_fee_lots')).rows.length,0);
    settled=true;
    // Provider changed the amount after the initial review. Require fresh approval.
    data.transaction_details.source_amount='20.00';
    const review=await reconcileStripeRamp(row);assert.equal(review.status,'review_required');assert.equal(review.grossCents,2200);
    assert.equal((await reconcileStripeRamp(row,{approval:'forged'})).status,'review_required');
    assert.equal((await db.query('SELECT * FROM cfk_fee_lots')).rows.length,0);
    assert.equal((await reconcileStripeRamp(row,{approval:review.reviewToken})).status,'completed');
    assert.equal((await reconcileStripeRamp(row,{approval:review.reviewToken})).status,'completed');
    const lot=(await db.query('SELECT * FROM cfk_fee_lots')).rows[0];assert.equal(Number(lot.original_fee_cents),0);assert.equal(Number(lot.original_units),180000000);
    assert.equal((await db.query("SELECT * FROM cfk_events WHERE name='Purchase'")).rows.length,0);
    assert.equal((await db.query("SELECT * FROM cfk_events WHERE name='InitiateCheckout'")).rows.length,1);
    const id=randomUUID();await db.query("INSERT INTO cfk_ramps SELECT $1,'cos_SECOND',user_id,wallet,direction,session_id,$2,gross_cents,platform_fee_cents,provider_fee_cents,net_cents,'pending',quote,created_at,NULL FROM cfk_ramps WHERE id=$3",[id,randomUUID(),row.id]);
    row=(await db.query('SELECT * FROM cfk_ramps WHERE id=$1',[id])).rows[0];data.id='cos_SECOND';data.metadata.cfk_ramp_id=id;
    await assert.rejects(reconcileStripeRamp(row),{code:'23505'});
    assert.equal((await db.query('SELECT * FROM cfk_fee_lots')).rows.length,1);
  }finally{
    pg.Pool.prototype.query=realQuery;pg.Pool.prototype.connect=realConnect;globalThis.fetch=realFetch;
    for(const key of names){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}await db.close();
  }
});
