import {randomUUID} from 'node:crypto';
import {VersionedTransaction} from '@solana/web3.js';
import {mint,SOL_MINT,NETWORK_RESERVE,fetchJson,appError,sha,allocateFee} from './core.mjs';
import {database,transaction} from './db.mjs';
import {position,rpc,supply} from './market.mjs';
import {getSession,recordEvent} from './events.mjs';

export async function prepareTrade(user,body){
  if(process.env.TRADING_ENABLED!=='true'||!process.env.JUPITER_API_KEY)throw appError('Buying and selling are being connected. Your money has not moved.',503);
  if(!['buy','sell'].includes(body.side)||!Number.isFinite(body.amountUsd)||body.amountUsd<.01||body.amountUsd>1000000)throw appError('Choose a valid amount.');
  await getSession(body.sessionId);
  const balance=await position(body.wallet),tokenSupply=await supply();
  const buying=body.side==='buy';
  if(balance.solAmount<NETWORK_RESERVE)throw appError('Add a little SOL for the network cost before continuing.');
  if(buying&&body.amountUsd>balance.availableUsd)throw appError('Add money or choose a smaller amount.');
  if(!buying&&(!balance.valueUsd||body.amountUsd>balance.valueUsd+.001))throw appError('Choose an amount within your CFK balance.');
  const input=buying?BigInt(Math.floor(body.amountUsd/balance.solUsd*1e9)):BigInt(Math.min(Number(balance.tokenAtomic),Math.floor(body.amountUsd/balance.valueUsd*Number(balance.tokenAtomic))));
  if(input<=0n)throw appError('This amount is too small.');
  const slippageBps=100;
  const params=new URLSearchParams({inputMint:buying?SOL_MINT:mint(),outputMint:buying?mint():SOL_MINT,amount:input.toString(),slippageBps:String(slippageBps),restrictIntermediateTokens:'true',instructionVersion:'V2'});
  const headers={'x-api-key':process.env.JUPITER_API_KEY};
  const quote=await fetchJson(`https://api.jup.ag/swap/v1/quote?${params}`,{headers});
  if(!quote.outAmount||BigInt(quote.outAmount)<=0n||quote.inAmount!==input.toString()||quote.inputMint!==params.get('inputMint')||quote.outputMint!==params.get('outputMint'))throw appError('No available route for this amount. Please try again.',503);
  if(Number(quote.priceImpactPct)>.03)throw appError('This amount would move the coin price by more than 3%. Try a smaller amount.');
  const swap=await fetchJson('https://api.jup.ag/swap/v1/swap',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({quoteResponse:quote,userPublicKey:body.wallet,wrapAndUnwrapSol:true,dynamicComputeUnitLimit:true,prioritizationFeeLamports:{priorityLevelWithMaxLamports:{maxLamports:500000,priorityLevel:'high'}}})});
  if(!swap.swapTransaction)throw appError('The transaction could not be prepared.',502);
  const tx=VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction,'base64'));
  if(tx.message.staticAccountKeys[0].toBase58()!==body.wallet)throw appError('The transaction does not match your wallet.',502);
  const simulation=await rpc('simulateTransaction',[swap.swapTransaction,{encoding:'base64',sigVerify:false,commitment:'confirmed'}]);
  if(simulation.value?.err)throw appError('This transaction cannot complete right now. Try a smaller amount.',409);
  const id=randomUUID(),expires=new Date(Date.now()+30000);
  const amountUsd=buying?body.amountUsd:Number(quote.outAmount)/1e9*balance.solUsd;
  await database().query('INSERT INTO cfk_orders(id,user_id,wallet,side,session_id,amount_usd_cents,input_atomic,expected_token_atomic,quote,message_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,user.id,body.wallet,body.side,body.sessionId,Math.round(amountUsd*100),input.toString(),buying?quote.outAmount:input.toString(),{...quote,solUsd:balance.solUsd,decimals:tokenSupply.decimals},sha(tx.message.serialize()),expires]);
  return {orderId:id,transaction:swap.swapTransaction,amountUsd,tokens:Number(buying?quote.outAmount:input)/10**tokenSupply.decimals,slippageBps,networkReserveUsd:NETWORK_RESERVE*balance.solUsd,expiresAt:expires.toISOString()};
}
export async function submitTrade(user,body){
  if(!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(body.signature||''))throw appError('Invalid transaction signature.');
  const result=await database().query("UPDATE cfk_orders SET signature=$3,status=CASE WHEN status='prepared' THEN 'submitted' ELSE status END WHERE id=$1 AND user_id=$2 AND (signature IS NULL OR signature=$3) RETURNING id",[body.orderId,user.id,body.signature]);
  if(!result.rows.length)throw appError('Transaction not found.',404);return {accepted:true};
}
export async function confirmTrade(user,id){
  const order=(await database().query('SELECT * FROM cfk_orders WHERE id=$1 AND user_id=$2',[id,user.id])).rows[0];
  if(!order)throw appError('Transaction not found.',404);
  if(order.status==='confirmed')return receipt(order);
  if(order.status==='failed')throw appError('The transaction failed. Your balance has not been changed by this app.',409);
  if(!order.signature)return {confirmed:false};
  const data=await rpc('getTransaction',[order.signature,{commitment:'finalized',encoding:'base64',maxSupportedTransactionVersion:0}]);
  if(!data)return {confirmed:false};
  if(data.meta?.err){await database().query("UPDATE cfk_orders SET status='failed' WHERE id=$1",[id]);throw appError('The transaction failed. A network fee may still apply.',409);}
  const tx=VersionedTransaction.deserialize(Buffer.from(data.transaction[0],'base64'));
  if(sha(tx.message.serialize())!==order.message_hash||tx.message.staticAccountKeys[0].toBase58()!==order.wallet)throw appError('This transaction does not match your confirmed order.',409);
  let before=0n,after=0n;
  for(const b of data.meta.preTokenBalances||[])if(b.owner===order.wallet&&b.mint===mint())before+=BigInt(b.uiTokenAmount.amount);
  for(const b of data.meta.postTokenBalances||[])if(b.owner===order.wallet&&b.mint===mint())after+=BigInt(b.uiTokenAmount.amount);
  const change=after-before,buying=order.side==='buy';
  if(buying?change<=0n:change>=0n)throw appError('The expected coin movement was not confirmed.',409);
  const qty=buying?change:-change;
  // The entire message is matched to the server-built swap, so input units are fixed by the quote.
  const solLamports=buying?BigInt(order.input_atomic):BigInt(Math.max(0,data.meta.postBalances[0]-data.meta.preBalances[0]));
  const confirmedAt=new Date((data.blockTime||Math.floor(Date.now()/1000))*1000);
  await transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[order.wallet]);
    const locked=(await c.query('SELECT status FROM cfk_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(locked.status==='confirmed')return;
    let feeCents=0,remaining=solLamports;
    if(buying){
      const lots=(await c.query('SELECT * FROM cfk_fee_lots WHERE wallet=$1 AND remaining_units>0 ORDER BY created_at,id FOR UPDATE',[order.wallet])).rows;
      for(const lot of lots){if(remaining<=0n)break;const units=BigInt(lot.remaining_units),used=remaining<units?remaining:units;const fee=allocateFee(lot,used);feeCents+=fee;remaining-=used;await c.query('UPDATE cfk_fee_lots SET remaining_units=remaining_units-$2,remaining_fee_cents=remaining_fee_cents-$3 WHERE id=$1',[lot.id,used.toString(),fee]);}
    }
    const costCents=buying?Math.round(Number(solLamports)/1e9*order.quote.solUsd*100)+feeCents:0;
    await c.query('INSERT INTO cfk_trades(id,wallet,signature,side,token_atomic,sol_lamports,cost_cents,fee_revenue_cents,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',[id,order.wallet,order.signature,order.side,qty.toString(),solLamports.toString(),costCents,feeCents,confirmedAt]);
    await c.query("UPDATE cfk_orders SET status='confirmed',confirmed_at=$2 WHERE id=$1",[id,confirmedAt]);
    if(buying)await recordEvent(c,{id:'purchase_'+id,sessionId:order.session_id,name:'Purchase',valueCents:feeCents,metadata:{orderId:id,signature:order.signature,valueBasis:'earned_platform_fee'}});
  });
  return receipt(order);
}
async function receipt(order){const t=(await database().query('SELECT fee_revenue_cents FROM cfk_trades WHERE id=$1',[order.id])).rows[0];return {confirmed:true,side:order.side,signature:order.signature,event:order.side==='buy'?{eventId:'purchase_'+order.id,valueCents:Number(t?.fee_revenue_cents||0),currency:'USD'}:null};}
export async function reconcileTrades(){const orders=(await database().query("SELECT id,user_id FROM cfk_orders WHERE status='submitted' AND signature IS NOT NULL ORDER BY created_at LIMIT 10")).rows;let confirmed=0;for(const o of orders){try{if((await confirmTrade({id:o.user_id},o.id)).confirmed)confirmed++;}catch{}}return confirmed;}
