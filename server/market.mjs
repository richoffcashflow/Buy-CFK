import {CFK_MINT,SOL_MINT,mint,NETWORK_RESERVE,validAddress,fetchJson,normalizeActivity,appError} from './core.mjs';
import {database} from './db.mjs';
import {fetchCurve,curveAddress,pumpEvents,TOKEN_PROGRAM,TOKEN_2022} from './pump.mjs';
const cache=new Map();
async function cached(key,ttl,fn){const hit=cache.get(key);if(hit&&Date.now()-hit.at<ttl)return hit.data;const data=await fn();cache.set(key,{at:Date.now(),data});return data;}
export async function rpc(method,params=[]){return fetchJson(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}).then(d=>{if(d.error)throw appError('The Solana network is busy. Try again shortly.',502);return d.result;});}
export async function getPair(){return cached('pair:'+mint(),30000,async()=>{try{const data=await fetchJson(`https://api.dexscreener.com/token-pairs/v1/solana/${mint()}`);return data.filter(p=>p.baseToken?.address===mint()).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0]||null;}catch{return null;}});}
export async function solPrice(){return cached('solprice',30000,async()=>{const data=await fetchJson(`https://api.dexscreener.com/token-pairs/v1/solana/${SOL_MINT}`);const p=data.filter(p=>p.baseToken?.address===SOL_MINT).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];if(!p?.priceUsd)throw appError('SOL pricing is unavailable. Please try again.',503);return Number(p.priceUsd);});}
export async function supply(){return cached('supply:'+mint(),300000,async()=>{const r=await rpc('getTokenSupply',[mint(),{commitment:'confirmed'}]);return {amount:r.value.amount,decimals:r.value.decimals};});}
export async function tokenPrice(){return cached('price:'+mint(),20000,async()=>{
  const pair=await getPair();if(pair?.priceUsd)return {priceUsd:Number(pair.priceUsd),marketCap:pair.marketCap??null,source:'DexScreener',curve:false};
  const [curve,token,sol]=await Promise.all([fetchCurve(rpc),supply(),solPrice()]);
  if(!curve||curve.complete||curve.virtualToken<=0n)return {priceUsd:null,marketCap:null,source:null};
  const priceUsd=Number(curve.virtualSol)/Number(curve.virtualToken)*10**token.decimals/1e9*sol;
  return {priceUsd,marketCap:priceUsd*Number(token.amount)/10**token.decimals,source:'Pump.fun on-chain reserves',curve:true};
});}
export async function snapshotMarket(){
  const price=await tokenPrice();if(!price.priceUsd||!(process.env.DATABASE_URL||process.env.POSTGRES_URL))return price;
  const at=new Date(Math.floor(Date.now()/60000)*60000);
  await database().query('INSERT INTO cfk_market_samples(mint,observed_at,price_usd) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[mint(),at,price.priceUsd]);return price;
}
export async function getMarket(){
  const pair=await getPair();let holders=null,holderSource=null,price={priceUsd:null,marketCap:null,source:null},change=pair?.priceChange?.h24??null;
  try{price=await snapshotMarket();}catch{try{price=await tokenPrice();}catch{}}
  if(change===null&&price.priceUsd&&(process.env.DATABASE_URL||process.env.POSTGRES_URL)){try{const row=(await database().query("SELECT price_usd FROM cfk_market_samples WHERE mint=$1 AND observed_at<=now()-interval '24 hours' AND observed_at>=now()-interval '25 hours' ORDER BY observed_at DESC LIMIT 1",[mint()])).rows[0];if(row)change=(price.priceUsd/row.price_usd-1)*100;}catch{}}
  if(process.env.BIRDEYE_API_KEY){try{const d=await cached('holders:'+mint(),120000,()=>fetchJson(`https://public-api.birdeye.so/defi/token_overview?address=${mint()}`,{headers:{'X-API-KEY':process.env.BIRDEYE_API_KEY,'x-chain':'solana'}}));holders=Number.isInteger(d.data?.holder)?d.data.holder:null;}catch{}}
  if(holders!==null)holderSource='Birdeye';
  else try{holders=await cached('onchain-holders:'+mint(),300000,async()=>{
    const account=(await rpc('getAccountInfo',[mint(),{encoding:'base64',commitment:'confirmed'}])).value;
    if(![TOKEN_PROGRAM,TOKEN_2022].includes(account?.owner))return null;
    const accounts=await rpc('getProgramAccounts',[account.owner,{encoding:'jsonParsed',commitment:'confirmed',filters:[{memcmp:{offset:0,bytes:mint()}}]}]);
    const owners=new Set();for(const a of accounts){const d=a.account?.data?.parsed;if(d?.type==='account'&&d.info?.mint===mint()&&BigInt(d.info.tokenAmount?.amount||'0')>0n)owners.add(d.info.owner);}
    return owners.size;
  });holderSource='On-chain token owners, including protocol accounts';}catch{}
  return {mint:mint(),...price,change24h:change,holders,volume24h:pair?.volume?.h24??null,liquidity:pair?.liquidity?.usd??null,updatedAt:new Date().toISOString(),holderSource};
}
export async function getChart(range){
  const periods={'1h':['minute',1,60],'4h':['minute',5,48],'1d':['hour',1,24],'1w':['hour',4,42]};
  if(!periods[range])throw appError('Invalid chart range.');
  return cached('chart:'+range+mint(),30000,async()=>{const pair=await getPair();if(pair){try{const [timeframe,aggregate,limit]=periods[range];const data=await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair.pairAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=${mint()}`);const rows=data?.data?.attributes?.ohlcv_list||[];if(rows.length)return {points:rows.filter(p=>p.length>=5&&p.slice(0,5).every(Number.isFinite)).sort((a,b)=>a[0]-b[0]),source:'GeckoTerminal'};}catch{}}
    try{await snapshotMarket();const hours={'1h':1,'4h':4,'1d':24,'1w':168}[range];const rows=(await database().query("SELECT extract(epoch FROM observed_at) AS time,price_usd FROM cfk_market_samples WHERE mint=$1 AND observed_at>now()-($2 * interval '1 hour') ORDER BY observed_at",[mint(),hours])).rows;return {points:rows.map(r=>[Number(r.time),r.price_usd,r.price_usd,r.price_usd,r.price_usd,0]),source:'Observed on-chain prices',buildingHistory:true};}catch{return {points:[],buildingHistory:true};}
  });
}
export async function getActivity(){return cached('activity:'+mint(),45000,async()=>{const pair=await getPair();if(pair){try{const data=await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair.pairAddress}/trades`);return {items:normalizeActivity(data.data||[],mint()),updatedAt:new Date().toISOString(),source:'GeckoTerminal'};}catch{}}
  const token=await supply(),signatures=await rpc('getSignaturesForAddress',[curveAddress(),{limit:6,commitment:'finalized'}]);const items=[];
  const results=await Promise.allSettled(signatures.filter(s=>!s.err).map(async s=>pumpEvents(await rpc('getTransaction',[s.signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:0}]),s.signature,token.decimals)));
  for(const r of results)if(r.status==='fulfilled')items.push(...r.value);
  return {items,source:'Pump.fun confirmed transactions',updatedAt:new Date().toISOString(),unavailable:false};
});}
export async function position(wallet){
  if(!validAddress(wallet))throw appError('Invalid wallet.');
  const [balance,tokenAccounts,pair,sol]=await Promise.all([rpc('getBalance',[wallet,{commitment:'confirmed'}]),rpc('getTokenAccountsByOwner',[wallet,{mint:mint()},{encoding:'jsonParsed',commitment:'confirmed'}]),tokenPrice(),solPrice()]);
  let atomic=0n,decimals=null;for(const a of tokenAccounts.value){const token=a.account?.data?.parsed?.info?.tokenAmount;if(token){atomic+=BigInt(token.amount);decimals=token.decimals;}}
  const tokens=Number(atomic)/10**(decimals??0),price=pair?.priceUsd?Number(pair.priceUsd):null,valueUsd=price===null?null:tokens*price;
  const result={wallet,lamports:balance.value,tokenAtomic:atomic.toString(),decimals,tokens,valueUsd,solUsd:sol,solAmount:balance.value/1e9,availableUsd:Math.max(0,balance.value/1e9-NETWORK_RESERVE)*sol,totalUsd:valueUsd===null?null:valueUsd+balance.value/1e9*sol,pnlUsd:null,pnlPercent:null};
  if(!(process.env.DATABASE_URL||process.env.POSTGRES_URL)||atomic===0n||price===null)return result;
  const {rows}=await database().query('SELECT side, token_atomic, cost_cents FROM cfk_trades WHERE wallet=$1 ORDER BY confirmed_at,id',[wallet]);
  let held=0n,cost=0,valid=true;
  for(const r of rows){const qty=BigInt(r.token_atomic);if(r.side==='buy'){held+=qty;cost+=Number(r.cost_cents);}else{if(qty>held){valid=false;break;}cost=held>0n?cost*Number(held-qty)/Number(held):0;held-=qty;}}
  if(valid&&held===atomic&&cost>0){result.pnlUsd=valueUsd-cost/100;result.pnlPercent=result.pnlUsd/(cost/100)*100;}
  return result;
}
