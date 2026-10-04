import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {accountHistory} from '../server/account-history.mjs';

test('history returns only the authenticated owner and no provider or signing secrets',async()=>{
  const db=new PGlite();await db.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
  const previous=process.env.DATABASE_URL,original=pg.Pool.prototype.query;
  process.env.DATABASE_URL='postgres://test-only';pg.Pool.prototype.query=(sql,args)=>db.query(sql,args);
  try{
    const owned=randomUUID(),other=randomUUID();
    for(const [id,user] of [[owned,'owner'],[other,'other']])await db.query("INSERT INTO cfk_ramps(id,user_id,wallet,direction,checkout_id,gross_cents,platform_fee_cents,net_cents,status,quote) VALUES($1,$2,'wallet','onramp',$4,2000,300,1700,'completed',$3)",[id,user,{clientSecret:'must-not-leak'},id]);
    const order=randomUUID();
    await db.query("INSERT INTO cfk_orders(id,user_id,wallet,side,amount_usd_cents,input_atomic,expected_token_atomic,quote,message_hash,expires_at,funding_id,status) VALUES($1,'owner','wallet','buy',1700,10,10,$2,'hash',now(),$3,'prepared')",[order,{transaction:'must-not-leak'},owned]);
    let result=await accountHistory({id:'owner'});
    assert.equal(result.items.length,2);
    assert.equal(result.items.some(x=>x.id===other),false);
    assert.equal(JSON.stringify(result).includes('must-not-leak'),false);
    assert.equal(result.items.find(x=>x.id===owned).recoverable,true);
    assert.equal(result.items.find(x=>x.id===order).recoverable,false);
    await db.query("UPDATE cfk_orders SET status='submitted',signature='test-signature' WHERE id=$1",[order]);
    result=await accountHistory({id:'owner'});
    assert.equal(result.items.find(x=>x.id===order).recoverable,true);
    assert.equal(result.items.find(x=>x.id===order).rampId,owned);
    await db.query("UPDATE cfk_orders SET status='confirmed' WHERE id=$1",[order]);
    result=await accountHistory({id:'owner'});
    assert.ok(result.items.every(x=>!x.recoverable));
    assert.deepEqual(await accountHistory({id:'nobody'}),{hasCompletedSale:false,items:[]});
    assert.equal((await accountHistory({id:'owner'})).hasCompletedSale,false);
    await db.query("UPDATE cfk_orders SET side='sell' WHERE id=$1",[order]);
    assert.equal((await accountHistory({id:'owner'})).hasCompletedSale,true);
    const recent=[];
    for(let i=0;i<25;i++){
      const id=randomUUID();recent.push(id);
      await db.query("INSERT INTO cfk_ramps(id,user_id,wallet,direction,checkout_id,gross_cents,platform_fee_cents,net_cents,status,created_at) VALUES($1,'owner','wallet','offramp',$2,2000,300,1700,'completed',$3)",[id,id,new Date(Date.now()+(i+1)*1000)]);
    }
    const bounded=await accountHistory({id:'owner'});
    assert.equal(bounded.items.length,20);
    assert.equal(bounded.hasCompletedSale,true);
    assert.deepEqual(bounded.items.map(item=>item.id),recent.slice(-20).reverse());
  }finally{pg.Pool.prototype.query=original;if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;await db.close();}
});
