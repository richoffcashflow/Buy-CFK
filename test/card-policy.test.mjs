import test from 'node:test';
import assert from 'node:assert/strict';
import {cardConversionAmounts, cardWalletId, findOpenCard} from '../src/card-policy.js';
import {cardConfig, USDC_MINT} from '../server/card-config.mjs';

test('card conversion preserves every USDC unit and computes the agreed 15 percent', () => {
  assert.deepEqual(cardConversionAmounts('100000000'), {gross:'100000000',fee:'15000000',net:'85000000'});
  for (const amount of [1n,3n,9n,19n,999999n,123456789012345n]) {
    const value = cardConversionAmounts(amount);
    assert.equal(BigInt(value.fee)+BigInt(value.net),amount);
    assert.ok(BigInt(value.fee)<=amount);
  }
  assert.throws(()=>cardConversionAmounts(0));
  assert.throws(()=>cardConversionAmounts(-1));
});

test('the card funding wallet must be this users embedded Solana trading wallet', () => {
  const base={type:'wallet',walletClientType:'privy',connectorType:'embedded',chainType:'solana'};
  const accounts=[{...base,address:'wrong',id:'wrong'},{...base,address:'current',id:'external',walletClientType:'phantom'},
    {...base,address:'current',id:'evm',chainType:'ethereum'},{...base,address:'current',id:'right'}];
  assert.equal(cardWalletId(accounts,'current'),'right');
  assert.equal(cardWalletId(accounts,'missing'),undefined);
});

test('returning users find frozen cards across pages instead of creating duplicates', async () => {
  const calls=[];
  const card=await findOpenCard(async options=>{calls.push(options);return options.cursor
    ?{data:[{id:'existing',wallet_id:'wallet',status:'inactive'}],next_cursor:null}
    :{data:[{id:'closed',wallet_id:'wallet',status:'canceled'},{id:'someone-else',wallet_id:'other',status:'active'}],next_cursor:'page2'};
  },'production','wallet');
  assert.equal(card.id,'existing');
  assert.equal(calls[1].cursor,'page2');
  assert.ok(calls.every(x=>x.environment==='production'));
});

test('card list failures and broken pagination never imply an empty account', async () => {
  await assert.rejects(findOpenCard(async()=>{throw Error('provider down');},'production','wallet'),/provider down/);
  await assert.rejects(findOpenCard(async()=>({error:'failed'}),'production','wallet'));
  await assert.rejects(findOpenCard(async()=>({data:[],next_cursor:'same'}),'production','wallet'));
  assert.equal(await findOpenCard(async()=>({data:[],next_cursor:null}),'production','wallet'),null);
});

test('production card setup fails closed without the merchant-specific approval target', () => {
  const env={CARDS_ENABLED:'true',CARD_PROGRAM_ID:'11111111111111111111111111111111',CARD_MERCHANT_ID:'7',CARD_STABLECOIN_ADDRESS:USDC_MINT};
  assert.equal(cardConfig(env).enabled,true);
  for(const key of Object.keys(env))assert.equal(cardConfig({...env,[key]:''}).enabled,false);
  assert.equal(cardConfig({...env,CARD_MERCHANT_ID:'18446744073709551616'}).enabled,false);
  assert.equal(cardConfig({...env,CARD_MERCHANT_ID:'-1'}).enabled,false);
  assert.equal(cardConfig({...env,CARD_STABLECOIN_ADDRESS:'sandbox-mint'}).enabled,false);
  assert.equal(cardConfig({...env,CARD_PROGRAM_ID:'invalid-address'}).enabled,false);
});
