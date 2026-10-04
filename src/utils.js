export async function api(path,{method='GET',body,token,timeoutMs=45000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch('/api'+path,{method,signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw Object.assign(new Error(data?.message||'Could not connect. Please try again.'),{status:response.status});
    if(!data||typeof data!=='object')throw new Error('The connection returned an incomplete response. Please try again.');
    return data;
  }catch(error){
    if(controller.signal.aborted)throw new Error('The connection is taking too long. Please try again. Any saved payment will be checked before a new one is started.');
    if(error instanceof TypeError)throw new Error('Could not connect. Check your internet connection and try again.');
    throw error;
  }finally{clearTimeout(timer);}
}
export function formatMoney(n,precise=false,compact=false){if(n===null||n===undefined||!Number.isFinite(Number(n)))return '—';return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:precise&&n>0&&n<.01?9:2,...(compact&&Math.abs(n)>9999?{notation:'compact',maximumFractionDigits:2}:{})}).format(n);}
export function formatNumber(n){return n==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2,notation:Number(n)>999999?'compact':'standard'}).format(n);}
export function shortAddress(s){return s?`${s.slice(0,4)}…${s.slice(-4)}`:'—';}
