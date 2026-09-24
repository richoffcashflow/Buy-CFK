import {randomBytes} from 'node:crypto';
import {database,transaction} from './db.mjs';
import {appError,sha} from './core.mjs';
import {dispatchEvent,configuredDestinations} from './measurement.mjs';
const allowed=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','gbraid','wbraid','fbclid','ttclid','twclid','oppref','ref','fbp','fbc','ttp','obref','gaClientId'];
export function cleanAttribution(value){return Object.fromEntries(allowed.filter(k=>typeof value?.[k]==='string'&&value[k].length<=1024).map(k=>[k,value[k]]));}
export async function session(req,body){
  const consent=body.consent==='granted'&&req.headers['sec-gpc']!=='1';
  const candidate=body.startParam?.startsWith('s_')?body.startParam.slice(2):body.sessionId;
  const existing=/^[a-f0-9]{32}$/.test(candidate||'')?(await database().query('SELECT * FROM cfk_sessions WHERE id=$1 AND expires_at>now()',[candidate])).rows[0]:null;
  const id=existing?.id||randomBytes(16).toString('hex');
  const attribution=consent?{...(existing?.attribution||{}),...cleanAttribution(body.attribution)}:{};
  const sourceUrl=process.env.APP_URL||'http://localhost:4173';
  const ip=consent?String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].slice(0,80):null;
  const ua=consent?String(req.headers['user-agent']||'').slice(0,1024):null;
  await database().query('INSERT INTO cfk_sessions(id,consent,attribution,source_url,ip,user_agent) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET consent=$2,attribution=$3,ip=$5,user_agent=$6',[id,consent,attribution,sourceUrl,ip,ua]);
  return {id,consent,telegramUrl:process.env.TELEGRAM_BOT_USERNAME?`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?startapp=s_${id}`:null};
}
export async function getSession(id,c=database()){if(!/^[a-f0-9]{32}$/.test(id||''))throw appError('Your session is not ready. Please refresh.',401);const s=(await c.query('SELECT * FROM cfk_sessions WHERE id=$1 AND expires_at>now()',[id])).rows[0];if(!s)throw appError('Your session expired. Please refresh.',401);return s;}
export async function recordEvent(c,{id,sessionId,name,valueCents=0,metadata={}}){
  if(!sessionId)return;
  const s=(await c.query('SELECT * FROM cfk_sessions WHERE id=$1',[sessionId])).rows[0];
  if(!s)return;
  const snapshot={attribution:s.attribution,source_url:s.source_url,ip:s.ip,user_agent:s.user_agent};
  const inserted=await c.query('INSERT INTO cfk_events(id,session_id,name,value_cents,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',[id,sessionId,name,valueCents,{...metadata,measurement:snapshot}]);
  if(inserted.rows.length&&s.consent&&Date.parse(s.expires_at)>Date.now()){for(const provider of configuredDestinations(name)){await c.query('INSERT INTO cfk_deliveries(event_id,provider) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,provider]);}}
}
export async function browserEvent(req,body){
  if(!['ViewContent','InitiateCheckout'].includes(body.name))throw appError('This event requires a verified server receipt.',403);
  if(body.name==='InitiateCheckout'&&body.trigger!=='buy_pressed')throw appError('Funding events require a confirmed payment.',403);
  const prefix=body.name==='ViewContent'?'view':'checkout',id=body.eventId;
  if(!id?.startsWith(`${prefix}_${body.sessionId}_`)||!new RegExp(`^${prefix}_[a-f0-9]{32}_[a-f0-9-]{36}$`).test(id))throw appError('Invalid event identifier.');
  await database().query("UPDATE cfk_sessions SET attribution=attribution || $2::jsonb WHERE id=$1 AND consent=true",[body.sessionId,cleanAttribution(body.attribution)]);
  await transaction(c=>recordEvent(c,{id,sessionId:body.sessionId,name:body.name,metadata:{trigger:body.trigger}}));
  return {accepted:true,eventId:id};
}
export async function rateLimit(req,kind,max=60){
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0];
  const bucket=sha(ip)+':'+kind+':'+Math.floor(Date.now()/60000);
  const row=(await database().query("INSERT INTO cfk_rate_limits(bucket,count,expires_at) VALUES($1,1,now()+interval '2 minutes') ON CONFLICT(bucket) DO UPDATE SET count=cfk_rate_limits.count+1 RETURNING count",[bucket])).rows[0];
  if(row.count>max)throw appError('Too many requests. Please try again shortly.',429);
}
export async function flushEvents(limit=25){
  let delivered=0;
  for(let i=0;i<limit;i++){
    const row=await transaction(async c=>{
      const r=(await c.query("SELECT d.event_id,d.provider FROM cfk_deliveries d WHERE d.status IN ('pending','retry') AND d.next_attempt_at<=now() ORDER BY d.next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
      if(!r)return null;
      await c.query("UPDATE cfk_deliveries SET status='retry',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE event_id=$1 AND provider=$2",[r.event_id,r.provider]);
      return (await c.query('SELECT e.*,d.provider,d.attempts,s.attribution,s.source_url,s.ip,s.user_agent,s.consent,s.expires_at FROM cfk_events e JOIN cfk_deliveries d ON d.event_id=e.id JOIN cfk_sessions s ON s.id=e.session_id WHERE e.id=$1 AND d.provider=$2',[r.event_id,r.provider])).rows[0];
    });
    if(!row)break;
    if(!row.consent||Date.parse(row.expires_at)<Date.now()){
      await database().query("UPDATE cfk_deliveries SET status='suppressed' WHERE event_id=$1 AND provider=$2",[row.id,row.provider]);continue;
    }
    try{await dispatchEvent({...row,...row.metadata.measurement});await database().query("UPDATE cfk_deliveries SET status='delivered',delivered_at=now(),last_error=NULL WHERE event_id=$1 AND provider=$2",[row.id,row.provider]);delivered++;}
    catch{await database().query("UPDATE cfk_deliveries SET status=$3,next_attempt_at=now()+($4 * interval '1 second'),last_error='Delivery failed; check provider credentials and event configuration.' WHERE event_id=$1 AND provider=$2",[row.id,row.provider,row.attempts>=12?'failed':'retry',Math.min(21600,30*2**Math.min(row.attempts,9))]);}
  }
  return {delivered};
}
