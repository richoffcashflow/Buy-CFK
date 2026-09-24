import {fetchJson,mint,sha} from './core.mjs';
import {createHmac,randomBytes} from 'node:crypto';
export const openaiNames={ViewContent:'contents_viewed',InitiateCheckout:'checkout_started',Purchase:'order_created',Withdrawal:'custom'};
export function configuredDestinations(name){
  const e=process.env,result=[];
  if(e.META_PIXEL_ID&&e.META_ACCESS_TOKEN)result.push('meta');
  if(e.TIKTOK_PIXEL_ID&&e.TIKTOK_ACCESS_TOKEN)result.push('tiktok');
  if(e.OPENAI_PIXEL_ID&&e.OPENAI_CONVERSIONS_API_KEY)result.push('openai');
  if(name==='Purchase'&&e.GOOGLE_ADS_REFRESH_TOKEN&&e.GOOGLE_ADS_CONVERSION_ACTION)result.push('google');
  if(name==='Purchase'&&e.GA4_MEASUREMENT_ID&&e.GA4_API_SECRET)result.push('ga4');
  if(name!=='Withdrawal'&&e.X_PIXEL_ID&&e.X_CONSUMER_KEY&&e.X_CONSUMER_SECRET&&e.X_ACCESS_TOKEN&&e.X_ACCESS_TOKEN_SECRET)result.push('x');
  return result;
}
export function openaiEvent(e){return {id:e.id,type:openaiNames[e.name],...(e.name==='Withdrawal'?{custom_event_name:'withdrawal_fee'}:{}),timestamp_ms:Date.parse(e.created_at),oppref:e.attribution?.oppref,source_url:e.source_url,action_source:'web',opt_out:true,user:{obref:e.attribution?.obref,external_ids_sha256:[sha(e.session_id)],ip_address:e.ip,user_agent:e.user_agent},data:{type:e.name==='Withdrawal'?'custom':'contents',amount:Number(e.value_cents),currency:'USD',contents:[{id:mint(),name:'CFK platform fee',quantity:1,content_type:'product'}]}};}
export function metaEvent(e){return {event_name:e.name==='Withdrawal'?'WithdrawalFee':e.name,event_id:e.id,event_time:Math.floor(Date.parse(e.created_at)/1000),action_source:'website',event_source_url:e.source_url,user_data:{external_id:[sha(e.session_id)],fbp:e.attribution?.fbp,fbc:e.attribution?.fbc,client_ip_address:e.ip,client_user_agent:e.user_agent},custom_data:{value:Number(e.value_cents)/100,currency:'USD',content_ids:[mint()],content_name:'CFK platform fee',content_type:'product',order_id:e.id}};}
export function tiktokEvent(e){return {event:e.name==='Withdrawal'?'WithdrawalFee':e.name,event_time:Math.floor(Date.parse(e.created_at)/1000),event_id:e.id,user:{external_id:sha(e.session_id),ttclid:e.attribution?.ttclid,ttp:e.attribution?.ttp,ip:e.ip,user_agent:e.user_agent},page:{url:e.source_url},properties:{value:Number(e.value_cents)/100,currency:'USD',contents:[{content_id:mint(),content_name:'CFK platform fee',content_type:'product',quantity:1}]}};}
async function post(url,body,headers={}){return fetchJson(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
let oauth;
const percentEncode=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function xAuthorization(url,env,nonce=randomBytes(16).toString('hex'),timestamp=Math.floor(Date.now()/1000)){
  const p={oauth_consumer_key:env.X_CONSUMER_KEY,oauth_nonce:nonce,oauth_signature_method:'HMAC-SHA1',oauth_timestamp:String(timestamp),oauth_token:env.X_ACCESS_TOKEN,oauth_version:'1.0'};
  const normalized=Object.entries(p).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${percentEncode(k)}=${percentEncode(v)}`).join('&');
  const base=['POST',percentEncode(url),percentEncode(normalized)].join('&');
  p.oauth_signature=createHmac('sha1',`${percentEncode(env.X_CONSUMER_SECRET)}&${percentEncode(env.X_ACCESS_TOKEN_SECRET)}`).update(base).digest('base64');
  return 'OAuth '+Object.entries(p).map(([k,v])=>`${percentEncode(k)}="${percentEncode(v)}"`).join(', ');
}
async function googleToken(){if(oauth?.expires>Date.now())return oauth.token;const d=await fetchJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_ADS_CLIENT_ID,client_secret:process.env.GOOGLE_ADS_CLIENT_SECRET,refresh_token:process.env.GOOGLE_ADS_REFRESH_TOKEN,grant_type:'refresh_token'})});oauth={token:d.access_token,expires:Date.now()+(d.expires_in-60)*1000};return oauth.token;}
export async function dispatchEvent(e){
  const env=process.env;
  if(e.provider==='meta'){const data=await post(`https://graph.facebook.com/${env.META_API_VERSION||'v23.0'}/${env.META_PIXEL_ID}/events`,{data:[metaEvent(e)]},{Authorization:`Bearer ${env.META_ACCESS_TOKEN}`});if(data.events_received!==1)throw new Error('Meta did not accept event');}
  if(e.provider==='tiktok'){const data=await post('https://business-api.tiktok.com/open_api/v1.3/event/track/',{event_source:'web',event_source_id:env.TIKTOK_PIXEL_ID,data:[tiktokEvent(e)]},{'Access-Token':env.TIKTOK_ACCESS_TOKEN});if(data.code!==0)throw new Error('TikTok rejected event');}
  if(e.provider==='openai')await post(`https://bzr.openai.com/v1/events?pid=${encodeURIComponent(env.OPENAI_PIXEL_ID)}`,{events:[openaiEvent(e)],integration_source:'freecryptoapp_cfk'},{Authorization:`Bearer ${env.OPENAI_CONVERSIONS_API_KEY}`});
  if(e.provider==='google'){
    const a=e.attribution||{};const click=a.gclid?{gclid:a.gclid}:a.gbraid?{gbraid:a.gbraid}:a.wbraid?{wbraid:a.wbraid}:null;
    if(!click)throw new Error('No Google click identifier');
    const token=await googleToken();
    const data=await post(`https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION||'v22'}/customers/${env.GOOGLE_ADS_CUSTOMER_ID}:uploadClickConversions`,{partialFailure:true,conversions:[{...click,conversionAction:env.GOOGLE_ADS_CONVERSION_ACTION,conversionDateTime:new Date(e.created_at).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,'+00:00'),conversionValue:Number(e.value_cents)/100,currencyCode:'USD',orderId:e.id,consent:{adUserData:'GRANTED',adPersonalization:'DENIED'}}]},{Authorization:`Bearer ${token}`,'developer-token':env.GOOGLE_ADS_DEVELOPER_TOKEN,...(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?{'login-customer-id':env.GOOGLE_ADS_LOGIN_CUSTOMER_ID}:{})});
    if(data.partialFailureError)throw new Error('Google rejected event');
  }
  if(e.provider==='ga4'){
    const response=await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(env.GA4_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:e.attribution?.gaClientId||`${parseInt(e.session_id.slice(0,8),16)}.${Math.floor(Date.parse(e.created_at)/1000)}`,timestamp_micros:Date.parse(e.created_at)*1000,consent:{ad_user_data:'GRANTED',ad_personalization:'DENIED'},events:[{name:'purchase',params:{transaction_id:e.id,currency:'USD',value:Number(e.value_cents)/100,engagement_time_msec:1,items:[{item_id:mint(),item_name:'CFK platform fee',price:Number(e.value_cents)/100,quantity:1}]}}]}),signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('GA4 failed');
  }
  if(e.provider==='x'){
    const eventId={ViewContent:env.X_VIEW_EVENT_ID,InitiateCheckout:env.X_CHECKOUT_EVENT_ID,Purchase:env.X_PURCHASE_EVENT_ID}[e.name];if(!eventId)return;
    const url=`https://ads-api.x.com/12/measurement/conversions/${encodeURIComponent(env.X_PIXEL_ID)}`;
    const identifiers=[];if(e.attribution?.twclid)identifiers.push({twclid:e.attribution.twclid});if(e.ip&&e.user_agent)identifiers.push({ip_address:e.ip,user_agent:e.user_agent});
    if(!identifiers.length)throw new Error('No X matching identifiers');
    const result=await post(url,{conversions:[{event_id:eventId.replace(/^tw-[^-]+-/,''),conversion_id:e.id,conversion_time:new Date(e.created_at).toISOString(),value:(Number(e.value_cents)/100).toFixed(2),identifiers,number_items:1,description:'CFK platform fee',contents:[{content_id:mint(),content_name:'CFK platform fee',content_type:'product',content_price:Number(e.value_cents)/100,num_items:1}]}]},{Authorization:xAuthorization(url,env)});if(result.data?.conversions_processed!==1)throw new Error('X did not confirm delivery');
  }
}
