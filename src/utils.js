export async function api(path,{method='GET',body,token}={}){
  const response=await fetch('/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||'Could not connect. Please try again.');return data;
}
export function formatMoney(n,precise=false,compact=false){if(n===null||n===undefined||!Number.isFinite(Number(n)))return '—';return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:precise&&n>0&&n<.01?9:2,...(compact&&Math.abs(n)>9999?{notation:'compact',maximumFractionDigits:2}:{})}).format(n);}
export function formatNumber(n){return n==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2,notation:Number(n)>999999?'compact':'standard'}).format(n);}
export function shortAddress(s){return s?`${s.slice(0,4)}…${s.slice(-4)}`:'—';}
