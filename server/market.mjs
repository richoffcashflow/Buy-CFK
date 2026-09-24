import {CFK_MINT,SOL_MINT,mint,NETWORK_RESERVE,validAddress,fetchJson,normalizeActivity,appError} from './core.mjs';
import {database} from './db.mjs';
const cache=new Map();
async function cached(key,ttl,fn){const hit=cache.get(key);if(hit&&Date.now()-hit.at<ttl)return hit.data;const data=await fn();cache.set(key,{at:Date.now(),data});return data;}
export async function rpc(method,params=[]){return fetchJson(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}).then(d=>{if(d.error)throw appError('The Solana network is busy. Try again shortly.',502);return d.result;});}
export async function getPair(){return cached('pair:'+mint(),30000,async()=>{const data=await fetchJson(`https://api.dexscreener.com/token-pairs/v1/solana/${mint()}`);return data.filter(p=>p.baseToken?.address===mint()).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0]||null;});}
export async function solPrice(){return cached('solprice',30000,async()=>{const data=await fetchJson(`https://api.dexscreener.com/token-pairs/v1/solana/${SOL_MINT}`);const p=data.filter(p=>p.baseToken?.address===SOL_MINT).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];if(!p?.priceUsd)throw appError('SOL pricing is unavailable. Please try again.',503);return Number(p.priceUsd);});}
export async function supply(){return cached('supply:'+mint(),300000,async()=>{const r=await rpc('getTokenSupply',[mint(),{commitment:'confirmed'}]);return {amount:r.value.amount,decimals:r.value.decimals};});}
export async function getMarket(){
  const pair=await getPair();let holders=null;
  if(process.env.BIRDEYE_API_KEY){try{const d=await cached('holders:'+mint(),120000,()=>fetchJson(`https://public-api.birdeye.so/defi/token_overview?address=${mint()}`,{headers:{'X-API-KEY':process.env.BIRDEYE_API_KEY,'x-chain':'solana'}}));holders=Number.isInteger(d.data?.holder)?d.data.holder:null;}catch{}}
  return {mint:mint(),priceUsd:pair?.priceUsd?Number(pair.priceUsd):null,change24h:pair?.priceChange?.h24??null,marketCap:pair?.marketCap??null,holders,volume24h:pair?.volume?.h24??null,liquidity:pair?.liquidity?.usd??null,updatedAt:new Date().toISOString(),source:'DexScreener',holderSource:holders===null?null:'Birdeye'};
}
export async function getChart(range){
  const periods={'1h':['minute',1,60],'4h':['minute',5,48],'1d':['hour',1,24],'1w':['hour',4,42]};
  if(!periods[range])throw appError('Invalid chart range.');
  return cached('chart:'+range+mint(),30000,async()=>{const pair=await getPair();if(!pair)return {points:[]};const [timeframe,aggregate,limit]=periods[range];const data=await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair.pairAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=${mint()}`);const rows=data?.data?.attributes?.ohlcv_list||[];return {points:rows.filter(p=>p.length>=5&&p.slice(0,5).every(Number.isFinite)).sort((a,b)=>a[0]-b[0]),source:'GeckoTerminal'};});
}
export async function getActivity(){return cached('activity:'+mint(),30000,async()=>{const pair=await getPair();if(!pair)return {items:[],unavailable:true};const data=await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair.pairAddress}/trades`);return {items:normalizeActivity(data.data||[],mint()),updatedAt:new Date().toISOString(),source:'GeckoTerminal'};});}
export async function position(wallet){
  if(!validAddress(wallet))throw appError('Invalid wallet.');
  const [balance,tokenAccounts,pair,sol]=await Promise.all([rpc('getBalance',[wallet,{commitment:'confirmed'}]),rpc('getTokenAccountsByOwner',[wallet,{mint:mint()},{encoding:'jsonParsed',commitment:'confirmed'}]),getPair(),solPrice()]);
  let atomic=0n,decimals=null;for(const a of tokenAccounts.value){const token=a.account?.data?.parsed?.info?.tokenAmount;if(token){atomic+=BigInt(token.amount);decimals=token.decimals;}}
  const tokens=Number(atomic)/10**(decimals??0),price=pair?.priceUsd?Number(pair.priceUsd):null,valueUsd=price===null?null:tokens*price;
  const result={wallet,lamports:balance.value,tokenAtomic:atomic.toString(),decimals,tokens,valueUsd,solUsd:sol,solAmount:balance.value/1e9,availableUsd:Math.max(0,balance.value/1e9-NETWORK_RESERVE)*sol,totalUsd:valueUsd===null?null:valueUsd+balance.value/1e9*sol,pnlUsd:null,pnlPercent:null};
  if(!process.env.DATABASE_URL||atomic===0n||price===null)return result;
  const {rows}=await database().query('SELECT side, token_atomic, cost_cents FROM cfk_trades WHERE wallet=$1 ORDER BY confirmed_at,id',[wallet]);
  let held=0n,cost=0,valid=true;
  for(const r of rows){const qty=BigInt(r.token_atomic);if(r.side==='buy'){held+=qty;cost+=Number(r.cost_cents);}else{if(qty>held){valid=false;break;}cost=held>0n?cost*Number(held-qty)/Number(held):0;held-=qty;}}
  if(valid&&held===atomic&&cost>0){result.pnlUsd=valueUsd-cost/100;result.pnlPercent=result.pnlUsd/(cost/100)*100;}
  return result;
}
