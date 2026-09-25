import {publicConfig,appError} from '../server/core.mjs';
import {getMarket,getChart,getActivity,position,rpc,snapshotMarket} from '../server/market.mjs';
import {session,browserEvent,rateLimit,flushEvents} from '../server/events.mjs';
import {authenticate} from '../server/auth.mjs';
import {prepareTrade,submitTrade,confirmTrade,reconcileTrades} from '../server/trade.mjs';
import {approveRamp,createRamp,rampPreflight,rampStatus,rampWebhook,reconcileRamps} from '../server/ramp.mjs';
import {database} from '../server/db.mjs';
import {stripeWebhook} from '../server/stripe-payments.mjs';
export const config={api:{bodyParser:false},maxDuration:60};
async function rawBody(req){if(typeof req.body==='string')return req.body;if(Buffer.isBuffer(req.body))return req.body.toString('utf8');if(req.body&&typeof req.body==='object')return JSON.stringify(req.body);const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>100000)throw appError('Request too large.',413);chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks).toString('utf8');}
const allowedRpc=new Set(['getAccountInfo','getBalance','getBlockHeight','getFeeForMessage','getLatestBlockhash','getMultipleAccounts','getSignatureStatuses','getTokenAccountBalance','getTokenAccountsByOwner','getTransaction','isBlockhashValid','simulateTransaction','sendTransaction']);
export default async function handler(req,res){
  const url=new URL(req.url,'http://localhost');
  const path='/'+String(req.query?.route||url.searchParams.get('route')||url.pathname.replace(/^\/api\/?/,'')).replace(/^\//,'');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(data,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  try{
    if(req.method==='GET'){
      if(path==='/config')return reply(publicConfig());
      if(path==='/market'){res.setHeader('Cache-Control','public,s-maxage=20');return reply(await getMarket());}
      if(path==='/chart'){res.setHeader('Cache-Control','public,s-maxage=30');return reply(await getChart(url.searchParams.get('range')||'1d'));}
      if(path==='/activity'){res.setHeader('Cache-Control','public,s-maxage=20');return reply(await getActivity());}
      if(path==='/position')return reply(await position(url.searchParams.get('wallet')));
      if(path==='/ramp/status'){const user=await authenticate(req);return reply(await rampStatus(user,url.searchParams.get('id')));}
      if(path==='/jobs'){
        if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)throw appError('Unauthorized.',401);
        const trades=await reconcileTrades(),ramps=await reconcileRamps(),events=await flushEvents(20);
        try{await snapshotMarket();}catch{}
        // Public coin price history supports the month and all-time chart views.
        await database().query('DELETE FROM cfk_rate_limits WHERE expires_at<now()');
        await database().query("UPDATE cfk_sessions SET consent=false,attribution='{}',ip=NULL,user_agent=NULL WHERE expires_at<now() AND (consent OR attribution<>'{}'::jsonb)");
        return reply({trades,ramps,...events});
      }
      throw appError('Not found.',404);
    }
    if(req.method!=='POST')throw appError('Method not allowed.',405);
    const raw=await rawBody(req);
    if(path==='/stripe/webhook')return reply(await stripeWebhook(req,raw));
    if(path==='/ramp/webhook')return reply(await rampWebhook(req,raw));
    if(process.env.APP_URL&&req.headers.origin&&req.headers.origin!==new URL(process.env.APP_URL).origin)throw appError('Request origin is not allowed.',403);
    let body;try{body=JSON.parse(raw||'{}');}catch{throw appError('Invalid JSON.');}
    await rateLimit(req,path,path==='/rpc'?120:60);
    if(path==='/session')return reply(await session(req,body));
    if(path==='/events')return reply(await browserEvent(req,body));
    if(path==='/rpc'){
      if(!allowedRpc.has(body.method)||!Array.isArray(body.params||[]))throw appError('RPC method not allowed.',403);
      return reply({jsonrpc:'2.0',id:body.id??1,result:await rpc(body.method,body.params||[])});
    }
    const user=await authenticate(req,body.wallet);
    if(path==='/ramp/preflight')return reply(rampPreflight(body));
    if(path==='/trade/prepare')return reply(await prepareTrade(user,body));
    if(path==='/trade/submit')return reply(await submitTrade(user,body));
    if(path==='/trade/confirm')return reply(await confirmTrade(user,body.orderId));
    if(path==='/ramp/approve')return reply(await approveRamp(user,body));
    if(path==='/ramp/session')return reply(await createRamp(user,body));
    throw appError('Not found.',404);
  }catch(e){const status=e.status||500;if(status>=500){const code=String(e.code||e.name||'Error');console.error('CFK API request failed',{code:/^[A-Za-z0-9_]{1,64}$/.test(code)?code:'Error'});}return reply({message:e.status?e.message:'The app could not complete this request. Please try again.'},status);}
}
