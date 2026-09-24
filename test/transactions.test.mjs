import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {Keypair,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {CFK_MINT,sha} from '../server/core.mjs';
import {submitTrade,confirmTrade} from '../server/trade.mjs';

test('confirmed buys are idempotent; pending, failed, and mismatched transactions cannot create purchases',async()=>{
  const db=new PGlite();await db.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
  const realQuery=pg.Pool.prototype.query,realConnect=pg.Pool.prototype.connect,realFetch=globalThis.fetch;
  const previousUrl=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://test-only';
  const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args);
  pg.Pool.prototype.query=query;pg.Pool.prototype.connect=async()=>({query,release(){}});
  const payer=Keypair.generate().publicKey,recipient=Keypair.generate().publicKey;
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
  }finally{
    pg.Pool.prototype.query=realQuery;pg.Pool.prototype.connect=realConnect;globalThis.fetch=realFetch;
    if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;
    await db.close();
  }
});
