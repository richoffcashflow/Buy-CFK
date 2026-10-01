import {randomUUID} from 'node:crypto';
import {feeBreakdown,fetchJson,appError,checkWebhook,validAddress,checkoutAvailability} from './core.mjs';
import {database,transaction} from './db.mjs';
import {getSession,recordEvent} from './events.mjs';
import {position} from './market.mjs';
import {stripeReady} from './stripe-config.mjs';
import {createStripeRamp,reconcileStripeRamp} from './stripe-payments.mjs';
function providerBase(){if(process.env.RAMP_ENABLED!=='true'||!process.env.RAMP_ADAPTER_URL||!process.env.RAMP_ADAPTER_KEY)throw appError('Card payments and cash withdrawals are not available yet. The payment provider is being connected. Your money has not moved.',503);const url=new URL(process.env.RAMP_ADAPTER_URL);if(url.protocol!=='https:')throw appError('The payment connection is not ready.',503);return url.origin+url.pathname.replace(/\/$/,'');}
async function providerRequest(path,body){return fetchJson(providerBase()+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${process.env.RAMP_ADAPTER_KEY}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
export function rampPreflight(body){
  if(!checkoutAvailability().buyEnabled)throw appError('Buying is being connected. No payment has been taken.',503);
  if(!stripeReady())providerBase();
  feeBreakdown(body.grossCents);
  return {ready:true};
}
export async function createRamp(user,body){
  if(body.direction==='onramp'&&process.env.STRIPE_ONRAMP_ENABLED==='true')return createStripeRamp(user,body);
  if(body.direction==='onramp'&&body.intent==='buy'&&process.env.TRADING_ENABLED!=='true')throw appError('Buying is being connected. No payment has been taken.',503);
  providerBase();
  if(!['onramp','offramp'].includes(body.direction)||!validAddress(body.wallet))throw appError('Invalid payment request.');
  const fee=feeBreakdown(body.grossCents);
  if(!/^[a-f0-9-]{36}$/.test(body.checkoutId||''))throw appError('Invalid checkout.');
  await getSession(body.sessionId);
  const intent=body.direction==='onramp'&&body.intent==='buy'?'buy':'withdraw';
  // Persist one merchant identity before contacting the adapter. Concurrent
  // requests and uncertain network retries must use the same provider key.
  let row=await transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[user.id+':'+body.checkoutId]);
    const matches=(await c.query('SELECT * FROM cfk_ramps WHERE user_id=$1 AND checkout_id=$2 ORDER BY created_at LIMIT 2',[user.id,body.checkoutId])).rows;
    if(matches.length>1)throw appError('This checkout has multiple previous payment references. Contact support before paying again.',409);
    const existing=matches[0];
    if(existing){
      if(existing.quote?.provider==='stripe'||existing.quote?.adapterBase&&existing.quote.adapterBase!==providerBase())throw appError('This checkout uses an earlier payment connection. Check your previous payment before starting another.',409);
      if(existing.wallet!==body.wallet||existing.direction!==body.direction||Number(existing.gross_cents)!==body.grossCents||(existing.quote?.intent&&existing.quote.intent!==intent))throw appError('This checkout already has a different amount or destination. Check your previous payment before starting another.',409);
      return existing;
    }
    if(body.direction==='offramp'){const b=await position(body.wallet);if(body.grossCents/100>b.availableUsd)throw appError('Sell your CFK first or choose an amount within your available balance.');}
    const id=randomUUID();
    const request={idempotencyKey:id,merchantReference:id,direction:body.direction,wallet:body.wallet,asset:'SOL',network:'solana',currency:'USD',grossCents:fee.grossCents,platformFeeBps:1500,platformFeeCents:fee.platformFeeCents,embed:true,returnUrl:process.env.APP_URL,webhookUrl:process.env.APP_URL+'/api/ramp/webhook'};
    return (await c.query('INSERT INTO cfk_ramps(id,user_id,wallet,direction,session_id,gross_cents,platform_fee_cents,net_cents,checkout_id,quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[id,user.id,body.wallet,body.direction,body.sessionId,fee.grossCents,fee.platformFeeCents,fee.netCents,body.checkoutId,{provider:'adapter',adapterBase:providerBase(),intent,request}])).rows[0];
  });
  if(['completed','failed','review_required'].includes(row.status))return {provider:'adapter',rampId:row.id,direction:row.direction,existingPayment:true};
  if(row.provider_id)return adapterCheckout(row);
  // Older created rows already have a merchant reference. Reuse it rather than
  // orphaning a provider session that may exist after an interrupted response.
  const request=row.quote?.request||{idempotencyKey:row.id,merchantReference:row.id,direction:row.direction,wallet:row.wallet,asset:'SOL',network:'solana',currency:'USD',grossCents:Number(row.gross_cents),platformFeeBps:1500,platformFeeCents:Number(row.platform_fee_cents),embed:true,returnUrl:process.env.APP_URL,webhookUrl:process.env.APP_URL+'/api/ramp/webhook'};
  const quote=await providerRequest('/sessions',request);
  const expected=feeBreakdown(Number(row.gross_cents),quote.providerFeeCents);
  let url;try{url=new URL(quote.checkoutUrl||'');}catch{throw appError('The payment provider could not confirm the embedded checkout.',502);}
  const origins=(process.env.RAMP_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim());
  if(!quote.id||quote.grossCents!==Number(row.gross_cents)||quote.platformFeeCents!==expected.platformFeeCents||quote.netCents!==expected.netCents||url.protocol!=='https:'||!origins.includes(url.origin)||quote.embeddable!==true)throw appError('The payment provider could not confirm the amount, fees, or embedded checkout.',502);
  const updated=(await database().query("UPDATE cfk_ramps SET provider_id=$2,provider_fee_cents=$3,net_cents=$4,quote=$5,status='pending' WHERE id=$1 AND status='created' AND (provider_id IS NULL OR provider_id=$2) RETURNING *",[row.id,quote.id,expected.providerFeeCents,expected.netCents,{...quote,provider:'adapter',adapterBase:row.quote?.adapterBase||providerBase(),intent,request}])).rows[0];
  row=updated||(await database().query('SELECT * FROM cfk_ramps WHERE id=$1',[row.id])).rows[0];
  if(row.provider_id!==quote.id)throw appError('The provider returned conflicting checkout references. Contact support before paying.',409);
  return ['completed','failed','review_required'].includes(row.status)?{provider:'adapter',rampId:row.id,direction:row.direction,existingPayment:true}:adapterCheckout(row);
}
function adapterCheckout(row){
  return {provider:'adapter',rampId:row.id,direction:row.direction,providerName:process.env.RAMP_PROVIDER_NAME||'Payment provider',checkoutUrl:row.quote?.checkoutUrl,grossCents:Number(row.gross_cents),platformFeeCents:Number(row.platform_fee_cents),providerFeeCents:Number(row.provider_fee_cents),netCents:Number(row.net_cents)};
}

export async function reconcileRamp(row){
  if(row.quote?.provider==='stripe')return reconcileStripeRamp(row);
  if(row.quote?.adapterBase&&row.quote.adapterBase!==providerBase())throw appError('This payment uses an earlier payment connection. Contact support to check its status.',503);
  if(row.status==='completed')return {status:'completed',direction:row.direction};
  if(!row.provider_id)return {status:row.status};
  const payment=await providerRequest('/sessions/'+encodeURIComponent(row.provider_id));
  if(payment.status!=='completed')return {status:payment.status==='failed'?'failed':'pending',direction:row.direction};
  if(payment.merchantReference!==row.id||payment.wallet!==row.wallet||payment.direction!==row.direction||payment.currency!=='USD'||payment.grossCents!==Number(row.gross_cents)||payment.platformFeeCents!==Number(row.platform_fee_cents)||payment.netCents!==Number(row.net_cents)||payment.platformFeeSettled!==true)throw appError('The payment receipt could not be verified.',502);
  if(row.direction==='onramp'&&(!/^\d+$/.test(payment.deliveredLamports||'')||BigInt(payment.deliveredLamports)<=0n||payment.asset!=='SOL'||!payment.settlementReference))throw appError('The funding receipt is incomplete.',502);
  if(row.direction==='offramp'&&!payment.payoutReference)throw appError('The withdrawal has not been confirmed.',502);
  await transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[row.wallet]);
    const current=(await c.query('SELECT status FROM cfk_ramps WHERE id=$1 FOR UPDATE',[row.id])).rows[0];if(current.status==='completed')return;
    await c.query("UPDATE cfk_ramps SET status='completed',completed_at=now() WHERE id=$1",[row.id]);
    if(row.direction==='onramp'){
      await c.query('INSERT INTO cfk_fee_lots(id,wallet,remaining_units,original_units,remaining_fee_cents,original_fee_cents) VALUES($1,$2,$3,$3,$4,$4) ON CONFLICT DO NOTHING',[row.id,row.wallet,payment.deliveredLamports,payment.platformFeeCents]);
    }else await recordEvent(c,{id:'withdrawal_'+row.id,sessionId:row.session_id,name:'Withdrawal',valueCents:payment.platformFeeCents,metadata:{rampId:row.id,valueBasis:'earned_withdrawal_fee'}});
  });
  return {status:'completed',direction:row.direction};
}
export async function rampStatus(user,id){const row=(await database().query('SELECT * FROM cfk_ramps WHERE id=$1 AND user_id=$2',[id,user.id])).rows[0];if(!row)throw appError('Payment not found.',404);if(row.quote?.provider==='stripe')return reconcileStripeRamp(row,{includeCheckout:true});const result=await reconcileRamp(row);return result.status==='pending'&&row.provider_id?{...adapterCheckout(row),...result}:result;}
export async function rampWebhook(req,raw){
  if(!checkWebhook(raw,req.headers['x-cfk-timestamp'],req.headers['x-cfk-signature'],process.env.RAMP_WEBHOOK_SECRET))throw appError('Invalid webhook signature.',401);
  let body;try{body=JSON.parse(raw);}catch{throw appError('Invalid webhook.');}
  if(!/^[a-f0-9-]{36}$/.test(body.merchantReference||''))throw appError('Invalid payment reference.');
  const row=(await database().query('SELECT * FROM cfk_ramps WHERE id=$1',[body.merchantReference])).rows[0];if(!row)throw appError('Payment not found.',404);
  await reconcileRamp(row);return {received:true};
}
export async function reconcileRamps(){if(process.env.RAMP_ENABLED!=='true'&&!process.env.STRIPE_SECRET_KEY)return 0;const rows=(await database().query("SELECT * FROM cfk_ramps WHERE status IN ('pending','review_required') ORDER BY created_at LIMIT 10")).rows;let count=0;for(const row of rows){try{if((await reconcileRamp(row)).status==='completed')count++;}catch{}}return count;}

export async function approveRamp(user,body){
  const row=(await database().query('SELECT * FROM cfk_ramps WHERE id=$1 AND user_id=$2',[body.rampId,user.id])).rows[0];
  if(!row||row.quote?.provider!=='stripe')throw appError('Payment not found.',404);
  if(typeof body.reviewToken!=='string'||!body.reviewToken)throw appError('Review the payment before continuing.');
  return reconcileStripeRamp(row,{approval:body.reviewToken});
}
