import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {Keypair,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {CFK_MINT,sha} from '../server/core.mjs';
import {submitTrade,confirmTrade} from '../server/trade.mjs';
import {appendPlatformFee} from '../server/platform-fee.mjs';

test('confirmed buys are idempotent; pending, failed, and mismatched transactions cannot create purchases',async()=>{
  const db=new PGlite();await db.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
  const realQuery=pg.Pool.prototype.query,realConnect=pg.Pool.prototype.connect,realFetch=globalThis.fetch;
  const previousUrl=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://test-only';
  const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args);
  pg.Pool.prototype.query=query;pg.Pool.prototype.connect=async()=>({query,release(){}});
  const payerKey=Keypair.generate(),payer=payerKey.publicKey,recipient=Keypair.generate().publicKey;
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:SystemProgram.programId.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:payer,toPubkey:recipient,lamports:500})]}).compileToV0Message());
  const encoded=Buffer.from(tx.serialize()).toString('base64'),session='a'.repeat(32),wallet=payer.toBase58(),user={id:'test-user'};
  let chainData=null;
  globalThis.fetch=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:chainData}),{status:200,headers:{'Content-Type':'application/json'}});
  try{
    await db.query('INSERT INTO cfk_sessions(id,source_url) VALUES($1,$2)',[session,'https://example.com']);
    const ramp=randomUUID();
    await db.query("INSERT INTO cfk_ramps(id,user_id,wallet,direction,session_id,checkout_id,gross_cents,platform_fee_cents,net_cents,status) VALUES($1,$2,$3,'onramp',$4,$5,10000,1500,8500,'completed')",[ramp,user.id,wallet,session,randomUUID()]);
    await db.query('INSERT INTO cfk_fee_lots(id,wallet,remaining_units,original_units,remaining_fee_cents,original_fee_cents) VALUES($1,$2,1000,1000,1500,1500)',[ramp,wallet]);
    async function order(messageHash=sha(tx.message.serialize())){
      const id=randomUUID();await db.query("INSERT INTO cfk_orders(id,user_id,wallet,side,session_id,amount_usd_cents,input_atomic,expected_token_atomic,quote,message_hash,expires_at) VALUES($1,$2,$3,'buy',$4,5000,500,2000,$5,$6,now()+interval '1 minute')",[id,user.id,wallet,session,{solUsd:100},messageHash]);return id;
    }
    const id=await order(),signature='1'.repeat(64);
    await assert.rejects(submitTrade({id:'other'}, {orderId:id,signature}),{status:404});
    await submitTrade(user,{orderId:id,signature});
    assert.equal((await confirmTrade(user,id)).confirmed,false);
    assert.equal((await db.query('SELECT * FROM cfk_events')).rows.length,0);
    chainData={transaction:[encoded,'base64'],blockTime:1790251200,meta:{err:null,preBalances:[10000],postBalances:[9500],preTokenBalances:[],postTokenBalances:[{owner:wallet,mint:CFK_MINT,uiTokenAmount:{amount:'2000'}}]}};
    const first=await confirmTrade(user,id);assert.equal(first.event.valueCents,750);
    await submitTrade(user,{orderId:id,signature});
    assert.deepEqual(await confirmTrade(user,id),first);
    const lot=(await db.query('SELECT * FROM cfk_fee_lots')).rows[0];
    assert.equal(Number(lot.remaining_units),500);assert.equal(Number(lot.remaining_fee_cents),750);
    assert.equal((await db.query('SELECT * FROM cfk_events')).rows.length,1);
    const failed=await order();await submitTrade(user,{orderId:failed,signature:'2'.repeat(64)});
    chainData.meta.err={InstructionError:[0,'Custom']};await assert.rejects(confirmTrade(user,failed),{status:409});
    const mismatch=await order('incorrect-message');await submitTrade(user,{orderId:mismatch,signature:'3'.repeat(64)});
    chainData.meta.err=null;await assert.rejects(confirmTrade(user,mismatch),{status:409});
    assert.equal((await db.query('SELECT * FROM cfk_events')).rows.length,1);
    assert.equal((await db.query('SELECT * FROM cfk_trades')).rows.length,1);
    const funding=randomUUID();
    await db.query("INSERT INTO cfk_ramps(id,user_id,wallet,direction,session_id,checkout_id,gross_cents,platform_fee_cents,net_cents,status,quote) VALUES($1,$2,$3,'onramp',$4,$5,2000,300,1700,'completed',$6)",[funding,user.id,wallet,session,randomUUID(),{intent:'buy'}]);
    await db.query('INSERT INTO cfk_fee_lots(id,wallet,remaining_units,original_units,remaining_fee_cents,original_fee_cents) VALUES($1,$2,1000,1000,300,300)',[funding,wallet]);
    const fundedOrder=await order();
    await db.query('UPDATE cfk_orders SET funding_id=$2,quote=$3 WHERE id=$1',[fundedOrder,funding,{provider:'PumpPortal',solUsd:100}]);
    tx.sign([payerKey]);
    const signed=Buffer.from(tx.serialize()).toString('base64');
    const bad=VersionedTransaction.deserialize(Buffer.from(signed,'base64'));bad.signatures[0][0]^=1;
    await assert.rejects(submitTrade(user,{orderId:fundedOrder,transaction:Buffer.from(bad.serialize()).toString('base64')}),{status:401});
    assert.equal((await db.query('SELECT status FROM cfk_orders WHERE id=$1',[fundedOrder])).rows[0].status,'prepared');
    let broadcasts=0;
    globalThis.fetch=async(url,opts)=>{
      const request=JSON.parse(opts.body);let result=chainData;
      if(request.method==='sendTransaction'){
        const saved=(await db.query('SELECT signature,status FROM cfk_orders WHERE id=$1',[fundedOrder])).rows[0];
        assert.ok(saved.signature);assert.ok(['submitted','confirmed'].includes(saved.status));broadcasts++;result=saved.signature;
      }
      return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{status:200,headers:{'Content-Type':'application/json'}});
    };
    const sent=await submitTrade(user,{orderId:fundedOrder,transaction:signed});assert.ok(sent.signature);assert.equal(broadcasts,1);
    chainData.transaction=[signed,'base64'];
    const fundedReceipt=await confirmTrade(user,fundedOrder);assert.equal(fundedReceipt.event.valueCents,300);
    await submitTrade(user,{orderId:fundedOrder,transaction:signed});
    assert.deepEqual(await confirmTrade(user,fundedOrder),fundedReceipt);
    const fundedLot=(await db.query('SELECT * FROM cfk_fee_lots WHERE id=$1',[funding])).rows[0];
    assert.equal(Number(fundedLot.remaining_fee_cents),0);assert.equal(Number(fundedLot.remaining_units),500);
    const duplicate=await order();
    await assert.rejects(db.query('UPDATE cfk_orders SET funding_id=$2 WHERE id=$1',[duplicate,funding]),{code:'23505'});
    assert.equal((await db.query("SELECT count(*) FROM cfk_events WHERE name='Purchase'")).rows[0].count,2);
    const admin=Keypair.generate().publicKey,fee={recipient:admin.toBase58(),lamports:'300',cents:300};
    const atomic=appendPlatformFee(tx,[],wallet,fee);atomic.sign([payerKey]);
    const atomicEncoded=Buffer.from(atomic.serialize()).toString('base64'),stripeFunding=randomUUID();
    await db.query("INSERT INTO cfk_ramps(id,user_id,wallet,direction,session_id,checkout_id,gross_cents,platform_fee_cents,net_cents,status,quote) VALUES($1,$2,$3,'onramp',$4,$5,2000,300,1500,'completed',$6)",[stripeFunding,user.id,wallet,session,randomUUID(),{provider:'stripe',intent:'buy'}]);
    await db.query('INSERT INTO cfk_fee_lots(id,wallet,remaining_units,original_units,remaining_fee_cents,original_fee_cents) VALUES($1,$2,1000,1000,0,0)',[stripeFunding,wallet]);
    const atomicOrder=await order(sha(atomic.message.serialize()));
    await db.query('UPDATE cfk_orders SET funding_id=$2,quote=$3 WHERE id=$1',[atomicOrder,stripeFunding,{provider:'PumpPortal',solUsd:100,platformFee:fee}]);
    await submitTrade(user,{orderId:atomicOrder,transaction:atomicEncoded});
    const adminIndex=atomic.message.staticAccountKeys.findIndex(k=>k.equals(admin));
    const preBalances=Array(atomic.message.staticAccountKeys.length).fill(0),postBalances=[...preBalances];
    preBalances[0]=10000;postBalances[0]=9200;
    chainData={transaction:[atomicEncoded,'base64'],blockTime:1790251200,meta:{err:null,preBalances,postBalances,preTokenBalances:[],postTokenBalances:[{owner:wallet,mint:CFK_MINT,uiTokenAmount:{amount:'2000'}}]}};
    // A bought coin without the exact admin transfer must not report earned revenue.
    await assert.rejects(confirmTrade(user,atomicOrder),{status:409});
    assert.equal((await db.query("SELECT count(*) FROM cfk_events WHERE name='Purchase'")).rows[0].count,2);
    chainData.meta.postBalances[adminIndex]=300;
    const atomicReceipt=await confirmTrade(user,atomicOrder);assert.equal(atomicReceipt.event.valueCents,300);
    assert.deepEqual(await confirmTrade(user,atomicOrder),atomicReceipt);
    const trade=(await db.query('SELECT fee_revenue_cents,cost_cents FROM cfk_trades WHERE id=$1',[atomicOrder])).rows[0];
    assert.equal(Number(trade.fee_revenue_cents),300);assert.equal(Number(trade.cost_cents),0); // Synthetic lamports round to 0 cents; fee is not added twice.
    assert.equal((await db.query("SELECT count(*) FROM cfk_events WHERE name='Purchase'")).rows[0].count,3);


  }finally{
    pg.Pool.prototype.query=realQuery;pg.Pool.prototype.connect=realConnect;globalThis.fetch=realFetch;
    if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;
    await db.close();
  }
});
