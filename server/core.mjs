import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
export const CFK_MINT='3Rcko4DWwbLQP6vZ2Juxy3gDbv3omNkeg5np17fbpump';
export const SOL_MINT='So11111111111111111111111111111111111111112';
export const FEE_BPS=1500;
export const NETWORK_RESERVE=0.006;
export const mint=()=>process.env.CFK_MINT||CFK_MINT;
export function feeBreakdown(grossCents,providerFeeCents=0){
  if(!Number.isSafeInteger(grossCents)||grossCents<1||grossCents>100000000||!Number.isSafeInteger(providerFeeCents)||providerFeeCents<0)throw new Error('Invalid amount.');
  const platformFeeCents=Math.round(grossCents*FEE_BPS/10000),netCents=grossCents-platformFeeCents-providerFeeCents;
  if(netCents<=0)throw new Error('The amount does not cover fees.');
  return {grossCents,platformFeeCents,providerFeeCents,netCents};
}
export function allocateFee(lot,spentUnits){
  const remaining=BigInt(lot.remaining_units),spent=BigInt(spentUnits),fee=Number(lot.remaining_fee_cents);
  if(remaining<=0n||spent<0n||spent>remaining||!Number.isSafeInteger(fee)||fee<0)throw new Error('Invalid fee allocation.');
  return spent===remaining?fee:Number(BigInt(fee)*spent/remaining);
}
export function validAddress(value){return typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);}
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function checkWebhook(raw,timestamp,signature,secret,now=Date.now()){
  if(!secret||!/^\d{10}$/.test(String(timestamp))||Math.abs(now/1000-Number(timestamp))>300||! /^[a-f0-9]{64}$/.test(signature||''))return false;
  return timingSafeEqual(Buffer.from(signature,'hex'),createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest());
}
export function normalizeActivity(rows,targetMint){
  const seen=new Set();return rows.flatMap(item=>{
    const a=item.attributes||{},side=a.to_token_address===targetMint?'buy':a.from_token_address===targetMint?'sell':null;
    if(!side||!a.tx_hash||seen.has(a.tx_hash)||!validAddress(a.tx_from_address)||!Number.isFinite(Date.parse(a.block_timestamp)))return [];
    seen.add(a.tx_hash);return [{id:a.tx_hash,signature:a.tx_hash,side,wallet:a.tx_from_address,usd:a.volume_in_usd!=null&&Number.isFinite(Number(a.volume_in_usd))&&Number(a.volume_in_usd)>=0?Number(a.volume_in_usd):null,timestamp:a.block_timestamp}];
  }).sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
}
export function appError(message,status=400){return Object.assign(new Error(message),{status});}
export function checkoutAvailability(){
  let adapterReady=false;
  try{adapterReady=new URL(process.env.RAMP_ADAPTER_URL).protocol==='https:';}catch{}
  const paymentsReady=Boolean(process.env.RAMP_ENABLED==='true'&&adapterReady&&process.env.RAMP_ADAPTER_KEY&&process.env.RAMP_WEBHOOK_SECRET&&process.env.RAMP_ALLOWED_ORIGINS);
  return {buyEnabled:paymentsReady&&process.env.TRADING_ENABLED==='true',withdrawEnabled:paymentsReady};
}
export function publicConfig(){return {
  mint:mint(),privyAppId:process.env.PRIVY_APP_ID||null,feeBps:FEE_BPS,company:'Free Crypto App LLC',
  checkout:checkoutAvailability(),
  tracking:{googleTagId:process.env.GOOGLE_TAG_ID||null,googleAdsId:process.env.GOOGLE_ADS_ID||null,googleConversions:{ViewContent:process.env.GOOGLE_VIEW_CONVERSION||null,InitiateCheckout:process.env.GOOGLE_CHECKOUT_CONVERSION||null,Purchase:process.env.GOOGLE_PURCHASE_CONVERSION||null},ga4ServerPurchases:Boolean(process.env.GA4_MEASUREMENT_ID&&process.env.GA4_API_SECRET),googleServerPurchases:Boolean(process.env.GOOGLE_ADS_REFRESH_TOKEN&&process.env.GOOGLE_ADS_CONVERSION_ACTION),metaPixelId:process.env.META_PIXEL_ID||null,tiktokPixelId:process.env.TIKTOK_PIXEL_ID||null,xPixelId:process.env.X_PIXEL_ID||null,xEvents:{ViewContent:process.env.X_VIEW_EVENT_ID||null,InitiateCheckout:process.env.X_CHECKOUT_EVENT_ID||null,Purchase:process.env.X_PURCHASE_EVENT_ID||null},openaiPixelId:process.env.OPENAI_PIXEL_ID||null}
};}
export async function fetchJson(url,options={}){const response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});if(!response.ok)throw appError('A connected service is unavailable. Please try again.',502);return response.json();}
