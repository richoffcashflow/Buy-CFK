import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {appError,feeBreakdown,validAddress,sha} from './core.mjs';
import {stripeConfiguration,stripeReady,validFeeRecipient} from './stripe-config.mjs';
import {database,transaction} from './db.mjs';
import {getSession,recordEvent} from './events.mjs';
import {rpc} from './market.mjs';

export function decimalUnits(value,decimals){
  if(typeof value!=='string'||value.length>80||!/^\d+(\.\d+)?$/.test(value))throw appError('The payment amount could not be verified.',502);
  const [whole,fraction='']=value.split('.');
  if(fraction.length>decimals&&/[1-9]/.test(fraction.slice(decimals)))throw appError('The payment precision could not be verified.',502);
  return BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.slice(0,decimals).padEnd(decimals,'0')||'0');
}
const cents=value=>{const amount=decimalUnits(value,2);if(amount>100000000n)throw appError('The payment amount is too large.',502);return Number(amount);};
const dollars=value=>(value/100).toFixed(2);
export async function stripeRequest(path,{body,idempotencyKey}={}){
  if(stripeConfiguration().secretKey!=='configured')throw appError('Stripe payments are being connected.',503);
  if(!/^\/v1\/crypto\/(onramp_sessions(?:\/cos_[A-Za-z0-9]+)?|onramp_quotes|onramp\/quotes)(\?[^#]*)?$/.test(path))throw appError('Invalid payment operation.',500);
  let response;
  try{response=await fetch('https://api.stripe.com'+path,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY.trim()}`,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:body?new URLSearchParams(body).toString():undefined,signal:AbortSignal.timeout(12000)});}catch{throw appError('Stripe could not be reached. Please try again.',503);}
  let data;try{data=await response.json();}catch{throw appError('Stripe returned an unreadable response.',502);}
  if(!response.ok)throw Object.assign(appError(response.status===401||response.status===403?'Stripe checkout access is not ready. No payment has been taken.':'Stripe could not prepare this payment. Please try again.',503),{stripeStatus:response.status});
  return data;
}
function checkMode(data){if(data?.livemode!==(stripeConfiguration().mode==='live'))throw appError('The payment environment does not match this app.',502);}
export async function stripeQuote(grossCents){
  feeBreakdown(grossCents);
  const query=new URLSearchParams({source_currency:'usd',source_total_amount:dollars(grossCents),'destination_currencies[]':'sol','destination_networks[]':'solana'});
  let data;try{data=await stripeRequest('/v1/crypto/onramp_quotes?'+query);}catch(e){if(e.stripeStatus!==404)throw e;data=await stripeRequest('/v1/crypto/onramp/quotes?'+query);}
  checkMode(data);
  const q=data.destination_network_quotes?.solana?.find(q=>q.destination_currency==='sol'&&q.destination_network==='solana');
  if(!q||data.source_currency!=='usd'||decimalUnits(q.destination_amount,9)<=0n)throw appError('A dollar payment is not available for this amount.',503);
  const sourceCents=cents(data.source_amount),totalCents=cents(q.source_total_amount);
  if(totalCents!==grossCents||sourceCents<=0||sourceCents>totalCents)throw appError('Stripe could not match your selected dollar amount.',502);
  return {...feeBreakdown(totalCents,totalCents-sourceCents),sourceCents};
}
function sessionMatches(data,row){
  checkMode(data);
  const d=data.transaction_details;
  if(data.object!=='crypto.onramp_session'||data.id!==row.provider_id||data.metadata?.cfk_ramp_id!==row.id||data.metadata?.cfk_wallet!==row.wallet||!d||d.lock_wallet_address!==true||d.wallet_address&&d.wallet_address!==row.wallet||d.wallet_addresses?.solana!==row.wallet||d.destination_currency!=='sol'||d.destination_network!=='solana')throw appError('The payment does not match your account.',502);
  return d;
}
async function stripeCheckout(row){
  const data=await stripeRequest('/v1/crypto/onramp_sessions/'+row.provider_id);sessionMatches(data,row);
  if(typeof data.client_secret!=='string'||!data.client_secret.startsWith(row.provider_id+'_secret_'))throw appError('Stripe checkout is unavailable.',502);
  return {provider:'stripe',rampId:row.id,direction:'onramp',publishableKey:process.env.STRIPE_PUBLISHABLE_KEY.trim(),clientSecret:data.client_secret,grossCents:Number(row.gross_cents),providerFeeCents:Number(row.provider_fee_cents),platformFeeCents:Number(row.platform_fee_cents),netCents:Number(row.net_cents)};
}
export async function createStripeRamp(user,body){
  if(!stripeReady()||process.env.TRADING_ENABLED!=='true')throw appError('Buying is being connected. No payment has been taken.',503);
  if(body.direction!=='onramp'||body.intent!=='buy'||!validAddress(body.wallet)||body.wallet===process.env.PLATFORM_FEE_WALLET||!/^[a-f0-9-]{36}$/.test(body.checkoutId||''))throw appError('Invalid payment request.');
  feeBreakdown(body.grossCents);await getSession(body.sessionId);
  // Persist the quote and id before contacting Stripe. Retries reuse identical
  // parameters and the same Stripe idempotency key even after network timeouts.
  let row=await transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[user.id+':'+body.checkoutId]);
    const existing=(await c.query("SELECT * FROM cfk_ramps WHERE user_id=$1 AND checkout_id=$2 AND quote->>'provider'='stripe' ORDER BY created_at LIMIT 1",[user.id,body.checkoutId])).rows[0];
    if(existing){if(existing.wallet!==body.wallet||Number(existing.gross_cents)!==body.grossCents)throw appError('This checkout already has a different amount. Return to CFK and start a new purchase.',409);return existing;}
    const quote=await stripeQuote(body.grossCents),id=randomUUID();
    return (await c.query('INSERT INTO cfk_ramps(id,user_id,wallet,direction,session_id,gross_cents,platform_fee_cents,provider_fee_cents,net_cents,checkout_id,quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[id,user.id,body.wallet,'onramp',body.sessionId,quote.grossCents,quote.platformFeeCents,quote.providerFeeCents,quote.netCents,body.checkoutId,{provider:'stripe',intent:'buy',sourceCents:quote.sourceCents,feeRecipient:process.env.PLATFORM_FEE_WALLET,authorizedGrossCents:quote.grossCents,createdMode:stripeConfiguration().mode}])).rows[0];
  });
  if(['completed','review_required','failed'].includes(row.status))return {provider:'stripe',rampId:row.id,direction:'onramp',existingPayment:true};
  if(!row.provider_id){
    if(Date.now()-new Date(row.created_at).getTime()>23*60*60*1000)throw appError('This checkout expired. Contact support before starting another payment.',409);
    const data=await stripeRequest('/v1/crypto/onramp_sessions',{idempotencyKey:'cfk_'+row.id,body:{source_currency:'usd',source_amount:dollars(row.quote.sourceCents),destination_currency:'sol',destination_network:'solana','destination_currencies[]':'sol','destination_networks[]':'solana','wallet_addresses[solana]':row.wallet,lock_wallet_address:'true','metadata[cfk_ramp_id]':row.id,'metadata[cfk_wallet]':row.wallet}});
    if(!/^cos_[A-Za-z0-9]+$/.test(data.id||''))throw appError('Stripe checkout could not be verified.',502);
    sessionMatches(data,{...row,provider_id:data.id});
    row=(await database().query("UPDATE cfk_ramps SET provider_id=$2,status='pending' WHERE id=$1 AND status='created' RETURNING *",[row.id,data.id])).rows[0]||(await database().query('SELECT * FROM cfk_ramps WHERE id=$1',[row.id])).rows[0];
  }
  return stripeCheckout(row);
}
export function stripeFundingReceipt(data,row){
  const d=sessionMatches(data,row);
  if(data.status!=='fulfillment_complete')return null;
  if(d.wallet_address!==row.wallet||d.source_currency!=='usd'||!d.fees||!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(d.transaction_id||''))throw appError('The completed payment receipt is incomplete.',502);
  const sourceCents=cents(d.source_amount),providerFeeCents=cents(d.fees.network_fee_amount)+cents(d.fees.transaction_fee_amount);
  const fee=feeBreakdown(sourceCents+providerFeeCents,providerFeeCents),lamports=decimalUnits(d.destination_amount,9);
  if(lamports<=0n||lamports>BigInt(Number.MAX_SAFE_INTEGER)||!validFeeRecipient(row.quote.feeRecipient)||row.quote.feeRecipient===row.wallet)throw appError('The funding amounts could not be verified.',502);
  // Use the actual provider exchange rate; round up by at most one lamport.
  const feeLamports=(lamports*BigInt(fee.platformFeeCents)+BigInt(sourceCents)-1n)/BigInt(sourceCents);
  if(feeLamports>=lamports)throw appError('This payment does not cover purchase costs.',409);
  return {...fee,sourceCents,deliveredLamports:lamports.toString(),feeLamports:feeLamports.toString(),feeRecipient:row.quote.feeRecipient,transactionId:d.transaction_id};
}
function fundingEvent(row){return {eventId:`checkout_${row.session_id}_${row.checkout_id}`};}
export async function reconcileStripeRamp(row,{includeCheckout=false,approval}={}){
  if(row.status==='completed')return {status:'completed',direction:'onramp',event:fundingEvent(row)};
  if(row.status==='failed')return {status:'failed',direction:'onramp'};
  if(!row.provider_id)return {status:'pending',direction:'onramp'};
  const data=await stripeRequest('/v1/crypto/onramp_sessions/'+row.provider_id);sessionMatches(data,row);
  if(data.status==='rejected'){await database().query("UPDATE cfk_ramps SET status='failed' WHERE id=$1 AND status<>'completed'",[row.id]);return {status:'failed',direction:'onramp'};}
  const receipt=stripeFundingReceipt(data,row);
  if(!receipt)return {status:'pending',direction:'onramp',...(includeCheckout?await stripeCheckout(row):{})};
  // Never allow Stripe sandbox receipts to authorize real mainnet trades.
  if(data.livemode!==true)return {status:'sandbox_complete',direction:'onramp'};
  const chain=await rpc('getTransaction',[receipt.transactionId,{commitment:'finalized',encoding:'jsonParsed',maxSupportedTransactionVersion:0}]);
  if(!chain)return {status:'pending',direction:'onramp'};
  const i=chain.transaction?.message?.accountKeys?.findIndex(k=>(typeof k==='string'?k:k.pubkey)===row.wallet);
  if(chain.meta?.err||!Number.isInteger(i)||i<0||!Number.isSafeInteger(chain.meta.preBalances?.[i])||!Number.isSafeInteger(chain.meta.postBalances?.[i])||BigInt(chain.meta.postBalances[i])-BigInt(chain.meta.preBalances[i])<BigInt(receipt.deliveredLamports))throw appError('The funding transfer has not been verified.',502);
  const reviewToken=sha(JSON.stringify(receipt));
  const needsApproval=receipt.grossCents>row.quote.authorizedGrossCents;
  if(needsApproval&&approval!==reviewToken){
    await database().query("UPDATE cfk_ramps SET status='review_required' WHERE id=$1 AND status<>'completed'",[row.id]);
    return {status:'review_required',direction:'onramp',rampId:row.id,reviewToken,grossCents:receipt.grossCents,platformFeeCents:receipt.platformFeeCents,providerFeeCents:receipt.providerFeeCents,netCents:receipt.netCents};
  }
  await transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[row.wallet]);
    const current=(await c.query('SELECT * FROM cfk_ramps WHERE id=$1 FOR UPDATE',[row.id])).rows[0];if(current.status==='completed')return;
    // A Stripe settlement hash can only fund one CFK payment, even across wallets.
    await c.query('INSERT INTO cfk_stripe_settlements(transaction_id,ramp_id) VALUES($1,$2)',[receipt.transactionId,row.id]);
    const quote={...current.quote,funding:receipt,...(approval?{authorizedGrossCents:receipt.grossCents}:{})};
    await c.query("UPDATE cfk_ramps SET gross_cents=$2,platform_fee_cents=$3,provider_fee_cents=$4,net_cents=$5,quote=$6,status='completed',completed_at=now() WHERE id=$1",[row.id,receipt.grossCents,receipt.platformFeeCents,receipt.providerFeeCents,receipt.netCents,quote]);
    // No fee is earned at funding. The atomic coin purchase settles it later.
    await c.query('INSERT INTO cfk_fee_lots(id,wallet,remaining_units,original_units,remaining_fee_cents,original_fee_cents) VALUES($1,$2,$3,$3,0,0) ON CONFLICT DO NOTHING',[row.id,row.wallet,receipt.deliveredLamports]);
    await recordEvent(c,{id:fundingEvent(row).eventId,sessionId:row.session_id,name:'InitiateCheckout',metadata:{trigger:'money_added',rampId:row.id}});
  });
  return {status:'completed',direction:'onramp',event:fundingEvent(row)};
}
export function verifyStripeSignature(raw,header,secret,now=Date.now()){
  if(typeof header!=='string'||!secret)return false;
  const fields=header.split(',').map(v=>v.trim().split('=')),timestamps=fields.filter(([k])=>k==='t');
  if(timestamps.length!==1||!/^\d{10}$/.test(timestamps[0][1])||Math.abs(now/1000-Number(timestamps[0][1]))>300)return false;
  const expected=createHmac('sha256',secret).update(timestamps[0][1]+'.'+raw).digest();
  return fields.some(([key,value])=>key==='v1'&&/^[a-f0-9]{64}$/.test(value||'')&&timingSafeEqual(expected,Buffer.from(value,'hex')));
}
export async function stripeWebhook(req,raw){
  if(!verifyStripeSignature(raw,req.headers['stripe-signature'],process.env.STRIPE_ONRAMP_WEBHOOK_SECRET))throw appError('Invalid payment notification signature.',401);
  let event;try{event=JSON.parse(raw);}catch{throw appError('Invalid notification.');}
  const data=event.data?.object;
  if(data?.object!=='crypto.onramp_session')return {received:true};
  if(!/^cos_[A-Za-z0-9]+$/.test(data.id||''))throw appError('Invalid payment reference.');
  const row=(await database().query("SELECT * FROM cfk_ramps WHERE provider_id=$1 AND quote->>'provider'='stripe'",[data.id])).rows[0];
  if(row)await reconcileStripeRamp(row); // re-read Stripe; never trust event amounts
  return {received:true};
}
