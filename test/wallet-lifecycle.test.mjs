import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletOnDemand,walletForAction} from '../src/wallet-lifecycle.js';
import {checkoutAvailability,publicConfig} from '../server/core.mjs';
import {rampPreflight} from '../server/ramp.mjs';

test('empty accounts can sign in, inspect, or abandon without provisioning a wallet',async()=>{
  let creations=0;
  const ensureWallet=createWalletOnDemand({findWallet:()=>null,createWallet:async()=>{creations++;return {wallet:{address:'new-wallet'}};}});
  const bridge={address:null,ensureWallet};
  assert.equal(creations,0);
  await assert.rejects(walletForAction(bridge,'buy',{buyEnabled:false}),/being connected/);
  await assert.rejects(walletForAction(bridge,'sell',{}),/do not have any CFK/);
  await assert.rejects(walletForAction(bridge,'withdraw',{}),/no money to withdraw/);
  assert.equal(creations,0);
});

test('concurrent funding requests share a single wallet, including before SDK discovery catches up',async()=>{
  let creations=0,resolveCreation;
  const ensureWallet=createWalletOnDemand({findWallet:()=>null,createWallet:()=>{creations++;return new Promise(resolve=>{resolveCreation=resolve;});}});
  const bridge={address:null,ensureWallet};
  const first=walletForAction(bridge,'buy',{buyEnabled:true});
  const second=walletForAction(bridge,'buy',{buyEnabled:true});
  await Promise.resolve();
  assert.equal(creations,1);
  resolveCreation({wallet:{address:'created-once'}});
  assert.deepEqual(await Promise.all([first,second]),['created-once','created-once']);
  assert.equal(await ensureWallet(),'created-once');
  assert.equal(creations,1);
});

test('funded wallets are reused and a rejected creation can be retried',async()=>{
  let existing={address:'existing-wallet'},attempts=0;
  const ensureWallet=createWalletOnDemand({findWallet:()=>existing,createWallet:async()=>{attempts++;if(attempts===1)throw new Error('Cancelled');return {wallet:{address:'retry-wallet'}};}});
  assert.equal(await ensureWallet(),'existing-wallet');
  assert.equal(attempts,0);
  assert.equal(await walletForAction({address:'existing-wallet',ensureWallet},'sell',{}),'existing-wallet');
  existing=null;
  await assert.rejects(ensureWallet(),/Cancelled/);
  assert.equal(await ensureWallet(),'retry-wallet');
  assert.equal(attempts,2);
});

test('funding readiness fails closed before wallet creation and never exposes provider credentials',()=>{
  const values={RAMP_ENABLED:'true',TRADING_ENABLED:'true',RAMP_ADAPTER_URL:'https://provider.invalid',RAMP_ADAPTER_KEY:'private-test-provider-key',RAMP_WEBHOOK_SECRET:'private-test-webhook-key',RAMP_ALLOWED_ORIGINS:'https://checkout.invalid'};
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  try{
    Object.assign(process.env,values);
    assert.equal(checkoutAvailability().buyEnabled,true);
    assert.deepEqual(rampPreflight({grossCents:2000}),{ready:true});
    assert.throws(()=>rampPreflight({grossCents:0}));
    const config=JSON.stringify(publicConfig());
    assert.equal(config.includes(values.RAMP_ADAPTER_KEY),false);
    assert.equal(config.includes(values.RAMP_WEBHOOK_SECRET),false);
    for(const key of ['RAMP_ENABLED','TRADING_ENABLED','RAMP_ADAPTER_KEY','RAMP_WEBHOOK_SECRET','RAMP_ALLOWED_ORIGINS']){
      delete process.env[key];
      assert.equal(checkoutAvailability().buyEnabled,false,key);
      assert.throws(()=>rampPreflight({grossCents:2000}),{status:503});
      process.env[key]=values[key];
    }
    process.env.RAMP_ADAPTER_URL='http://provider.invalid';
    assert.equal(checkoutAvailability().buyEnabled,false);
  }finally{
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
