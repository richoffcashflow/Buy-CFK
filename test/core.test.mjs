import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {feeBreakdown,allocateFee,checkWebhook,normalizeActivity,CFK_MINT,SOL_MINT} from '../server/core.mjs';
import {openaiEvent,metaEvent,tiktokEvent} from '../server/measurement.mjs';
import {browserEvent,cleanAttribution} from '../server/events.mjs';

test('15% fees use cents and expose gross, platform, provider, and net',()=>{
  assert.deepEqual(feeBreakdown(10000,200),{grossCents:10000,platformFeeCents:1500,providerFeeCents:200,netCents:8300});
  assert.equal(feeBreakdown(999).platformFeeCents,150);
  for(const amount of [0,-1,NaN,Infinity,1.5,100000001])assert.throws(()=>feeBreakdown(amount));
  assert.throws(()=>feeBreakdown(100,90));
});
test('partial buys allocate the settled fee exactly once, including the final cent',()=>{
  const lot={remaining_units:'1000000000000000001',remaining_fee_cents:1501};let allocated=0;
  for(const spent of [250000000000000000n,250000000000000000n,500000000000000001n]){
    const fee=allocateFee(lot,spent);allocated+=fee;
    lot.remaining_units=String(BigInt(lot.remaining_units)-spent);lot.remaining_fee_cents-=fee;
  }
  assert.equal(allocated,1501);assert.equal(lot.remaining_units,'0');assert.equal(lot.remaining_fee_cents,0);
  assert.throws(()=>allocateFee(lot,1n));
});
test('webhooks reject tampering, stale timestamps, and absent secrets',()=>{
  const raw='{"merchantReference":"test-only"}',timestamp=1700000000,secret='fixture-secret';
  const sig=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex');
  assert.equal(checkWebhook(raw,timestamp,sig,secret,timestamp*1000),true);
  assert.equal(checkWebhook(raw+' ',timestamp,sig,secret,timestamp*1000),false);
  assert.equal(checkWebhook(raw,timestamp,sig,secret,(timestamp+301)*1000),false);
  assert.equal(checkWebhook(raw,timestamp,sig,'',timestamp*1000),false);
});
test('coin activity derives the side from this mint, deduplicates, and preserves unknown value',()=>{
  const row={attributes:{to_token_address:CFK_MINT,from_token_address:SOL_MINT,tx_hash:'test-only-signature',tx_from_address:SOL_MINT,block_timestamp:'2026-09-24T12:00:00Z',volume_in_usd:null}};
  const rows=normalizeActivity([row,row,{attributes:{...row.attributes,tx_hash:'unrelated',to_token_address:'other'}}],CFK_MINT);
  assert.equal(rows.length,1);assert.equal(rows[0].side,'buy');assert.equal(rows[0].usd,null);
});
test('ad providers share the receipt ID and use fee revenue in the required currency units',()=>{
  const event={id:'purchase_fixture',session_id:'a'.repeat(32),name:'Purchase',created_at:'2026-09-24T12:00:00Z',value_cents:1500,source_url:'https://example.com',attribution:{}};
  assert.equal(openaiEvent(event).data.amount,1500);
  assert.equal(metaEvent(event).custom_data.value,15);
  assert.equal(tiktokEvent(event).properties.value,15);
  assert.equal(openaiEvent(event).id,metaEvent(event).event_id);
  assert.equal(tiktokEvent(event).event_id,event.id);
  assert.equal(openaiEvent({...event,name:'Withdrawal'}).type,'custom');
  assert.equal(metaEvent({...event,name:'Withdrawal'}).event_name,'WithdrawalFee');
});
test('browser requests cannot fabricate purchases or successful funding',async()=>{
  await assert.rejects(browserEvent({}, {name:'Purchase'}),{status:403});
  await assert.rejects(browserEvent({}, {name:'InitiateCheckout',trigger:'money_added'}),{status:403});
  assert.deepEqual(cleanAttribution({gclid:'click',email:'private@example.com',wallet:SOL_MINT}),{gclid:'click'});
});
