import {api} from './utils.js';
const keys=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','gbraid','wbraid','fbclid','ttclid','twclid','oppref','ref'];
let sessionPromise=null,cachedConfig=null,installed=false;
const emitted=new Set();
const pageViewId=crypto.randomUUID();
let checkoutId=null;
export function getCheckoutId(){return checkoutId??=crypto.randomUUID();}
const storage={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}},remove:k=>{try{localStorage.removeItem(k);}catch{}}};
const cookie=name=>document.cookie.split('; ').find(x=>x.startsWith(name+'='))?.slice(name.length+1);
export function getConsent(){return navigator.globalPrivacyControl?'denied':storage.get('cfk_consent')||'unknown';}
export function captureAttribution(){
  if(getConsent()!=='granted')return {};
  const q=new URLSearchParams(location.search);let saved={};try{saved=JSON.parse(storage.get('cfk_attribution')||'{}');}catch{}
  const next=Object.fromEntries(keys.filter(k=>q.get(k)).map(k=>[k,q.get(k).slice(0,1024)]));
  const data={...(saved.expires>Date.now()?saved:{}),...next,expires:Date.now()+30*86400000};
  data.sourceUrl=location.origin+location.pathname;
  data.fbp=cookie('_fbp');data.fbc=cookie('_fbc')||(data.fbclid?`fb.1.${Date.now()}.${data.fbclid}`:undefined);data.ttp=cookie('_ttp');data.obref=cookie('__obref');data.oppref=data.oppref||cookie('__oppref');data.gaClientId=cookie('_ga')?.split('.').slice(-2).join('.');
  storage.set('cfk_attribution',JSON.stringify(data));return data;
}
export async function getSession(){
  if(!sessionPromise)sessionPromise=api('/session',{method:'POST',body:{sessionId:storage.get('cfk_session'),consent:getConsent(),attribution:captureAttribution(),startParam:window.Telegram?.WebApp?.initDataUnsafe?.start_param||new URLSearchParams(location.search).get('startapp')||null}}).then(d=>{storage.set('cfk_session',d.id);return d;}).catch(e=>{sessionPromise=null;throw e;});
  return sessionPromise;
}
export function setConsent(value){
  const effective=navigator.globalPrivacyControl?'denied':value;storage.set('cfk_consent',effective);
  if(effective!=='granted')storage.remove('cfk_attribution');
  window.fbq?.('consent',effective==='granted'?'grant':'revoke');window.oaiq?.('consent',effective==='granted');window.gtag?.('consent','update',{ad_storage:effective==='granted'?'granted':'denied',analytics_storage:effective==='granted'?'granted':'denied',ad_user_data:effective==='granted'?'granted':'denied',ad_personalization:'denied'});
  sessionPromise=null;getSession().catch(()=>{});
}
function script(src){const s=document.createElement('script');s.async=true;s.src=src;document.head.appendChild(s);}
function install(config){
  if(installed||getConsent()!=='granted')return;installed=true;const c=config?.tracking||{};
  if(c.googleTagId){window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};window.gtag('consent','default',{ad_storage:'granted',analytics_storage:'granted',ad_user_data:'granted',ad_personalization:'denied'});window.gtag('js',new Date());window.gtag('config',c.googleTagId,{send_page_view:false});if(c.googleAdsId)window.gtag('config',c.googleAdsId);script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(c.googleTagId)}`);}
  if(c.metaPixelId){const fb=window.fbq=window.fbq||function(){fb.callMethod?fb.callMethod.apply(fb,arguments):fb.queue.push(arguments);};fb.queue=fb.queue||[];fb.loaded=true;fb.version='2.0';fb('init',c.metaPixelId);script('https://connect.facebook.net/en_US/fbevents.js');}
  if(c.tiktokPixelId){const q=window.ttq=window.ttq||[];for(const method of ['track','page','identify','ready','consent','enableCookie','disableCookie'])q[method]=q[method]||function(){q.push([method,...arguments]);};q._i=q._i||{};q._i[c.tiktokPixelId]=[];q._i[c.tiktokPixelId]._u='https://analytics.tiktok.com/i18n/pixel/events.js';q._t=q._t||{};q._t[c.tiktokPixelId]=Date.now();q._o=q._o||{};q._o[c.tiktokPixelId]={};script(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(c.tiktokPixelId)}&lib=ttq`);}
  if(c.xPixelId){const x=window.twq=window.twq||function(){x.exe?x.exe.apply(x,arguments):x.queue.push(arguments);};x.version='1.1';x.queue=x.queue||[];x('config',c.xPixelId);script('https://static.ads-twitter.com/uwt.js');}
  if(c.openaiPixelId){const q=window.oaiq=window.oaiq||function(){q.q.push(arguments);};q.q=q.q||[];q('consent',true);q('init',{pixelId:c.openaiPixelId});script('https://bzrcdn.openai.com/sdk/oaiq.min.js');}
}
export async function track(name,details={},config,options={}){
  if(config)cachedConfig=config;config=cachedConfig;
  if(!config||getConsent()!=='granted')return;
  if(name==='Purchase'&&(!options.verified||!details.eventId||!Number.isSafeInteger(details.valueCents)))throw new Error('A confirmed purchase receipt is required.');
  const session=await getSession();
  const eventId=details.eventId||(name==='ViewContent'?`view_${session.id}_${pageViewId}`:name==='InitiateCheckout'?`checkout_${session.id}_${getCheckoutId()}`:crypto.randomUUID());
  if(emitted.has(eventId))return;
  if(name!=='Purchase'&&!(options.verified&&details.trigger==='money_added'))await api('/events',{method:'POST',body:{name,eventId,sessionId:session.id,trigger:details.trigger,attribution:captureAttribution()}});
  emitted.add(eventId);install(config);
  const c=config.tracking||{},value=name==='Purchase'?details.valueCents/100:0;
  const common={currency:'USD',value,content_ids:[config.mint],content_type:'product',content_name:'CFK platform fee'};
  window.fbq?.('track',name,common,{eventID:eventId});
  window.ttq?.track(name==='Purchase'?'Purchase':name,common,{event_id:eventId});
  if(c.xEvents?.[name])window.twq?.('event',c.xEvents[name],{value,currency:'USD',conversion_id:eventId});
  window.oaiq?.('measure',{ViewContent:'contents_viewed',InitiateCheckout:'checkout_started',Purchase:'order_created'}[name],{type:'contents',currency:'USD',amount:name==='Purchase'?details.valueCents:0,contents:[{id:config.mint,name:'CFK platform fee',content_type:'product',quantity:1}]},{event_id:eventId});
  const googleName={ViewContent:'view_item',InitiateCheckout:'begin_checkout',Purchase:'purchase'}[name];
  if(!(name==='Purchase'&&c.ga4ServerPurchases))window.gtag?.('event',googleName,{currency:'USD',value,transaction_id:eventId,items:[{item_id:config.mint,item_name:'CFK platform fee',price:value,quantity:1}]});
  if(c.googleConversions?.[name]&&!(name==='Purchase'&&c.googleServerPurchases))window.gtag?.('event','conversion',{send_to:c.googleConversions[name],value,currency:'USD',transaction_id:eventId});
  window.dataLayer?.push({event:`cfk_${name}`,event_id:eventId,currency:'USD',value,fee_revenue_cents:details.valueCents??0});
  if(name==='Purchase')checkoutId=null;
}
