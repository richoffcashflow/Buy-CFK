import {randomUUID,createPublicKey,verify} from 'node:crypto';
import {VersionedTransaction} from '@solana/web3.js';
import {getBase58Decoder} from '@solana/kit';
import {mint,NETWORK_RESERVE,appError,sha,allocateFee} from './core.mjs';
import {database,transaction} from './db.mjs';
import {position,rpc,supply} from './market.mjs';
import {getSession,recordEvent} from './events.mjs';
import {pumpTransaction} from './pump.mjs';
import {verifyPlatformFee} from './platform-fee.mjs';

function preparedReceipt(order){
  if(order.signature||order.status==='confirmed')return {existingOrder:true,orderId:order.id,signature:order.signature};
  if(order.status==='failed')throw appError('This trade failed. Your remaining funds are available to withdraw.',409);
  return {...order.quote.review,orderId:order.id,transaction:order.quote.transaction,expiresAt:new Date(order.expires_at).toISOString()};
}
export async function prepareTrade(user,body){
  if(process.env.TRADING_ENABLED!=='true')throw appError('Buying and selling are being connected. Your money has not moved.',503);
  if(!['buy','sell'].includes(body.side))throw appError('Choose Buy or Sell.');
  const buying=body.side==='buy';
  if(body.fundingId&&!/^[a-f0-9-]{36}$/.test(body.fundingId))throw appError('Invalid payment reference.');
  if(!body.fundingId&&(!Number.isFinite(body.amountUsd)||body.amountUsd<.01||body.amountUsd>1000000))throw appError('Choose a valid dollar amount.');
  if(body.fundingId&&!buying)throw appError('A payment can only fund a purchase.');
  await getSession(body.sessionId);
  return transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[body.wallet]);
    let funding,existing;
    if(body.fundingId){
      funding=(await c.query("SELECT r.*,l.remaining_units FROM cfk_ramps r JOIN cfk_fee_lots l ON l.id=r.id WHERE r.id=$1 AND r.user_id=$2 AND r.wallet=$3 AND r.direction='onramp' AND r.status='completed'",[body.fundingId,user.id,body.wallet])).rows[0];
      if(!funding||funding.quote?.intent!=='buy')throw appError('Your payment is not yet verified for this purchase.',409);
      existing=(await c.query('SELECT * FROM cfk_orders WHERE funding_id=$1',[funding.id])).rows[0];
      if(existing&&(existing.signature||existing.status!=='prepared'||new Date(existing.expires_at)>new Date()))return preparedReceipt(existing);
    }
    const [balance,tokenSupply]=await Promise.all([position(body.wallet),supply()]);
    if(balance.solAmount<=NETWORK_RESERVE)throw appError('Your available funds do not yet cover trading costs. Please wait for payment confirmation or choose a smaller amount.');
    let input,cashLimit,platformFee;
    if(funding?.quote?.provider==='stripe'){
      const receipt=funding.quote.funding;
      if(!receipt||BigInt(funding.remaining_units)!==BigInt(receipt.deliveredLamports))throw appError('This payment has already been used. Contact support before trying again.',409);
      platformFee={recipient:receipt.feeRecipient,lamports:receipt.feeLamports,cents:receipt.platformFeeCents};
    }
    if(buying){
      const available=BigInt(Math.max(0,Math.floor(balance.lamports-NETWORK_RESERVE*1e9)));
      if(platformFee&&available+BigInt(Math.ceil(NETWORK_RESERVE*1e9))<BigInt(funding.remaining_units))throw appError('Some of this payment has already moved from your account. Contact support before trying again.',409);
      cashLimit=funding?(BigInt(funding.remaining_units)<available?BigInt(funding.remaining_units):available):BigInt(Math.floor(body.amountUsd/balance.solUsd*1e9));
      if(cashLimit>available)throw appError('Choose an amount within your available funds.');
      // Reserve room inside the selected dollar budget for route costs and the price allowance.
      input=(cashLimit-6000000n-(platformFee?BigInt(platformFee.lamports):0n))*100n/104n;
    }else{
      if(!balance.valueUsd||body.amountUsd>balance.valueUsd+.01)throw appError('Choose an amount within your CFK position.');
      input=BigInt(Math.min(Number(balance.tokenAtomic),Math.floor(body.amountUsd/balance.valueUsd*Number(balance.tokenAtomic))));
    }
    if(input<=0n)throw appError('This amount does not cover trading costs. Choose a larger amount.');
    const slippageBps=100,swap=await pumpTransaction({wallet:body.wallet,side:body.side,input,decimals:tokenSupply.decimals,slippageBps,cashLimit:cashLimit===undefined?undefined:cashLimit-(platformFee?BigInt(platformFee.lamports):0n),platformFee,rpc});
    if(buying&&swap.solAtomic>cashLimit)throw appError('Trading costs exceed this payment’s budget. Please try again.',409);
    const amountUsd=Number(swap.solAtomic)/1e9*balance.solUsd;
    const review={amountUsd,tokens:Number(swap.tokenAtomic)/10**tokenSupply.decimals,slippageBps,provider:'PumpPortal',providerFeeBps:50};
    const quote={...(platformFee?{platformFee}:{}),provider:'PumpPortal',solUsd:balance.solUsd,decimals:tokenSupply.decimals,transaction:swap.transaction,review};
    const expires=new Date(Date.now()+45000),id=existing?.id||randomUUID();
    if(existing)await c.query('UPDATE cfk_orders SET amount_usd_cents=$2,input_atomic=$3,expected_token_atomic=$4,quote=$5,message_hash=$6,expires_at=$7 WHERE id=$1',[id,Math.max(1,Math.round(amountUsd*100)),input.toString(),swap.tokenAtomic.toString(),quote,sha(swap.tx.message.serialize()),expires]);
    else await c.query('INSERT INTO cfk_orders(id,user_id,wallet,side,session_id,amount_usd_cents,input_atomic,expected_token_atomic,quote,message_hash,expires_at,funding_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,user.id,body.wallet,body.side,body.sessionId,Math.max(1,Math.round(amountUsd*100)),input.toString(),swap.tokenAtomic.toString(),quote,sha(swap.tx.message.serialize()),expires,funding?.id||null]);
    return {orderId:id,transaction:swap.transaction,...review,expiresAt:expires.toISOString()};
  });
}
export async function submitTrade(user,body){
  let signed,signature=body.signature;
  if(body.transaction){
    if(typeof body.transaction!=='string'||body.transaction.length>1700)throw appError('Invalid signed transaction.');
    try{signed=VersionedTransaction.deserialize(Buffer.from(body.transaction,'base64'));}catch{throw appError('Invalid signed transaction.');}
    signature=getBase58Decoder().decode(signed.signatures[0]);
  }
  if(!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature||''))throw appError('Invalid transaction signature.');
  await transaction(async c=>{
    const order=(await c.query('SELECT * FROM cfk_orders WHERE id=$1 AND user_id=$2 FOR UPDATE',[body.orderId,user.id])).rows[0];
    if(!order)throw appError('Transaction not found.',404);
    if(order.signature&&order.signature!==signature)throw appError('This order already has a different transaction.',409);
    if(signed){
      if(sha(signed.message.serialize())!==order.message_hash||signed.message.staticAccountKeys[0].toBase58()!==order.wallet||signed.message.header.numRequiredSignatures!==1)throw appError('The signed transaction does not match your order.',409);
      const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),signed.message.staticAccountKeys[0].toBuffer()]),format:'der',type:'spki'});
      if(!verify(null,signed.message.serialize(),key,signed.signatures[0]))throw appError('The transaction signature could not be verified.',401);
      if(!order.signature&&new Date(order.expires_at)<new Date())throw appError('This price expired. Please retry for a fresh price.',409);
    }else if(order.quote.provider==='PumpPortal')throw appError('A signed transaction is required.');
    await c.query("UPDATE cfk_orders SET signature=$2,status=CASE WHEN status='prepared' THEN 'submitted' ELSE status END WHERE id=$1",[order.id,signature]);
  });
  // Save the signature first so the worker can confirm even if this request is interrupted.
  if(signed){try{await rpc('sendTransaction',[body.transaction,{encoding:'base64',skipPreflight:false,maxRetries:3}]);}catch{return {accepted:true,signature,pending:true};}}
  return {accepted:true,signature};
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
  const settledPlatformFee=verifyPlatformFee(tx,data.meta,order.wallet,order.quote.platformFee);
  const solLamports=buying?(order.quote.provider==='PumpPortal'?BigInt(Math.max(0,data.meta.preBalances[0]-data.meta.postBalances[0])):BigInt(order.input_atomic)):BigInt(Math.max(0,data.meta.postBalances[0]-data.meta.preBalances[0]));
  const confirmedAt=new Date((data.blockTime||Math.floor(Date.now()/1000))*1000);
  await transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[order.wallet]);
    const locked=(await c.query('SELECT status FROM cfk_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(locked.status==='confirmed')return;
    let feeCents=0,remaining=solLamports;
    if(buying&&order.funding_id){
      const lot=(await c.query('SELECT * FROM cfk_fee_lots WHERE id=$1 AND wallet=$2 FOR UPDATE',[order.funding_id,order.wallet])).rows[0];
      if(!lot)throw appError('The payment fee receipt is unavailable.',409);
      // The verified on-ramp fee belongs to this one automatic purchase, including any unspent reserve.
      feeCents=order.quote.platformFee?settledPlatformFee:Number(lot.remaining_fee_cents);
      const used=solLamports<BigInt(lot.remaining_units)?solLamports:BigInt(lot.remaining_units);
      await c.query('UPDATE cfk_fee_lots SET remaining_units=remaining_units-$2,remaining_fee_cents=0 WHERE id=$1',[lot.id,used.toString()]);
    }else if(buying){
      const lots=(await c.query('SELECT * FROM cfk_fee_lots WHERE wallet=$1 AND remaining_units>0 ORDER BY created_at,id FOR UPDATE',[order.wallet])).rows;
      for(const lot of lots){if(remaining<=0n)break;const units=BigInt(lot.remaining_units),used=remaining<units?remaining:units;const fee=allocateFee(lot,used);feeCents+=fee;remaining-=used;await c.query('UPDATE cfk_fee_lots SET remaining_units=remaining_units-$2,remaining_fee_cents=remaining_fee_cents-$3 WHERE id=$1',[lot.id,used.toString(),fee]);}
    }
    const costCents=buying?Math.round(Number(solLamports)/1e9*order.quote.solUsd*100)+(order.quote.platformFee?0:feeCents):0;
    await c.query('INSERT INTO cfk_trades(id,wallet,signature,side,token_atomic,sol_lamports,cost_cents,fee_revenue_cents,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',[id,order.wallet,order.signature,order.side,qty.toString(),solLamports.toString(),costCents,feeCents,confirmedAt]);
    await c.query("UPDATE cfk_orders SET status='confirmed',confirmed_at=$2 WHERE id=$1",[id,confirmedAt]);
    if(buying)await recordEvent(c,{id:'purchase_'+id,sessionId:order.session_id,name:'Purchase',valueCents:feeCents,metadata:{orderId:id,signature:order.signature,valueBasis:'earned_platform_fee'}});
  });
  return receipt(order);
}
async function receipt(order){const t=(await database().query('SELECT fee_revenue_cents FROM cfk_trades WHERE id=$1',[order.id])).rows[0];return {confirmed:true,side:order.side,signature:order.signature,event:order.side==='buy'?{eventId:'purchase_'+order.id,valueCents:Number(t?.fee_revenue_cents||0),currency:'USD'}:null};}
export async function reconcileTrades(){const orders=(await database().query("SELECT id,user_id FROM cfk_orders WHERE status='submitted' AND signature IS NOT NULL ORDER BY created_at LIMIT 10")).rows;let confirmed=0;for(const o of orders){try{if((await confirmTrade({id:o.user_id},o.id)).confirmed)confirmed++;}catch{}}return confirmed;}
