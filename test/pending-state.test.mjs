import test from 'node:test';
import assert from 'node:assert/strict';
import {readPending,pendingTrade,savedAmount} from '../src/pending-state.js';
function storage(value){return {value,get(){return this.value;},remove(){this.value=null;}};}
test('unresolved payment and trade references survive after 24 hours',()=>{
  for(const pending of [
    {type:'payment',rampId:'payment-id'},
    {type:'funded',rampId:'payment-id'},
    {type:'trade',orderId:'order-id',rampId:'payment-id'}
  ]){
    pending.savedAt=Date.now()-7*24*60*60*1000;
    const store=storage(JSON.stringify(pending));
    assert.deepEqual(readPending([store]),pending);
    assert.ok(store.value);
  }
});
test('malformed session data falls back to durable recovery and rejects wrong identifiers',()=>{
  const bad=storage('{'),good=storage(JSON.stringify({type:'payment',rampId:'recover'}));
  assert.equal(readPending([bad,good]).rampId,'recover');
  assert.equal(bad.value,null);
  for(const pending of [{type:'payment',orderId:'wrong'},{type:'trade',rampId:'wrong'},{type:'other',rampId:'wrong'}])assert.equal(readPending([storage(JSON.stringify(pending))]),null);
});
test('signing and existing-order retries retain the original funding reference',()=>{
  const funding={type:'funded',rampId:'payment-id'};
  assert.deepEqual(pendingTrade({orderId:'order-id'},funding,'buy','signed-transaction'),{type:'trade',orderId:'order-id',side:'buy',transaction:'signed-transaction',rampId:'payment-id'});
  assert.deepEqual(pendingTrade({orderId:'order-id',signature:'signature'},funding,'buy'),{type:'trade',orderId:'order-id',side:'buy',signature:'signature',rampId:'payment-id'});
  assert.equal(pendingTrade({orderId:'sell-id'},funding,'sell').rampId,undefined);
});

test('saved amount keeps the last valid dollar selection and rejects invalid values',()=>{
  for(const value of ['20','50','100','37.25'])assert.equal(savedAmount(storage(value)),value);
  for(const value of [null,'','0','-5','Infinity','1000001','12.345','bad'])assert.equal(savedAmount(storage(value)),'20');
});
