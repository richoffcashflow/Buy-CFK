import {randomUUID} from 'node:crypto';
import {feeBreakdown,fetchJson,appError,checkWebhook,validAddress} from './core.mjs';
import {database,transaction} from './db.mjs';
import {getSession,recordEvent} from './events.mjs';
import {position} from './market.mjs';
function providerBase(){if(process.env.RAMP_ENABLED!=='true'||!process.env.RAMP_ADAPTER_URL||!process.env.RAMP_ADAPTER_KEY)throw appError('Card payments and cash withdrawals are not available yet. The payment provider is being connected. Your money has not moved.',503);const url=new URL(process.env.RAMP_ADAPTER_URL);if(url.protocol!=='https:')throw appError('The payment connection is not ready.',503);return url.origin+url.pathname.replace(/\/$/,'');}
async function providerRequest(path,body){return fetchJson(providerBase()+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${process.env.RAMP_ADAPTER_KEY}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
export async function createRamp(user,body){
  providerBase();
  if(!['onramp','offramp'].includes(body.direction)||!validAddress(body.wallet))throw appError('Invalid payment request.');
  const fee=feeBreakdown(body.grossCents);
  if(!/^[a-f0-9-]{36}$/.test(body.checkoutId||''))throw appError('Invalid checkout.');
  await getSession(body.sessionId);
  if(body.direction==='offramp'){const b=await position(body.wallet);if(body.grossCents/100>b.availableUsd)throw appError('Sell your CFK first or choose an amount within your available balance.');}
  const id=randomUUID();
  await database().query('INSERT INTO cfk_ramps(id,user_id,wallet,direction,session_id,gross_cents,platform_fee_cents,net_cents,checkout_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,user.id,body.wallet,body.direction,body.sessionId,fee.grossCents,fee.platformFeeCents,fee.netCents,body.checkoutId]);
  // This contract is implemented by the approved provider adapter. No provider is enabled by default.
  const quote=await providerRequest('/sessions',{idempotencyKey:id,merchantReference:id,direction:body.direction,wallet:body.wallet,asset:'SOL',network:'solana',currency:'USD',grossCents:fee.grossCents,platformFeeBps:1500,platformFeeCents:fee.platformFeeCents,embed:true,returnUrl:process.env.APP_URL,webhookUrl:process.env.APP_URL+'/api/ramp/webhook'});
  const expected=feeBreakdown(fee.grossCents,quote.providerFeeCents);
  const url=new URL(quote.checkoutUrl||'');
  const origins=(process.env.RAMP_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim());
  if(!quote.id||quote.grossCents!==fee.grossCents||quote.platformFeeCents!==expected.platformFeeCents||quote.netCents!==expected.netCents||url.protocol!=='https:'||!origins.includes(url.origin)||quote.embeddable!==true)throw appError('The payment provider could not confirm the amount, fees, or embedded checkout.',502);
  await database().query("UPDATE cfk_ramps SET provider_id=$2,provider_fee_cents=$3,net_cents=$4,quote=$5,status='pending' WHERE id=$1",[id,quote.id,expected.providerFeeCents,expected.netCents,quote]);
  return {rampId:id,providerName:process.env.RAMP_PROVIDER_NAME||'Payment provider',checkoutUrl:url.toString(),...expected};
}
export async function reconcileRamp(row){
  if(row.status==='completed')return {status:'completed',direction:row.direction,event:row.direction==='onramp'?{eventId:`checkout_${row.session_id}_${row.checkout_id}`} :null};
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
      await recordEvent(c,{id:`checkout_${row.session_id}_${row.checkout_id}`,sessionId:row.session_id,name:'InitiateCheckout',metadata:{trigger:'money_added',rampId:row.id}});
    }else await recordEvent(c,{id:'withdrawal_'+row.id,sessionId:row.session_id,name:'Withdrawal',valueCents:payment.platformFeeCents,metadata:{rampId:row.id,valueBasis:'earned_withdrawal_fee'}});
  });
  return {status:'completed',direction:row.direction,event:row.direction==='onramp'?{eventId:`checkout_${row.session_id}_${row.checkout_id}`} :null};
}
export async function rampStatus(user,id){const row=(await database().query('SELECT * FROM cfk_ramps WHERE id=$1 AND user_id=$2',[id,user.id])).rows[0];if(!row)throw appError('Payment not found.',404);return reconcileRamp(row);}
export async function rampWebhook(req,raw){
  if(!checkWebhook(raw,req.headers['x-cfk-timestamp'],req.headers['x-cfk-signature'],process.env.RAMP_WEBHOOK_SECRET))throw appError('Invalid webhook signature.',401);
  let body;try{body=JSON.parse(raw);}catch{throw appError('Invalid webhook.');}
  if(!/^[a-f0-9-]{36}$/.test(body.merchantReference||''))throw appError('Invalid payment reference.');
  const row=(await database().query('SELECT * FROM cfk_ramps WHERE id=$1',[body.merchantReference])).rows[0];if(!row)throw appError('Payment not found.',404);
  await reconcileRamp(row);return {received:true};
}
export async function reconcileRamps(){if(process.env.RAMP_ENABLED!=='true')return 0;const rows=(await database().query("SELECT * FROM cfk_ramps WHERE status='pending' ORDER BY created_at LIMIT 10")).rows;let count=0;for(const row of rows){try{if((await reconcileRamp(row)).status==='completed')count++;}catch{}}return count;}
