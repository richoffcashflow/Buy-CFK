import React,{useEffect,useRef,useState} from 'react';

const scripts=new Map();
function loadScript(src){
  if(scripts.has(src))return scripts.get(src);
  const promise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=src;script.async=true;
    script.onload=()=>resolve();script.onerror=()=>{script.remove();scripts.delete(src);reject(new Error('The secure payment screen could not load. Please try again.'));};
    document.head.appendChild(script);
  });scripts.set(src,promise);return promise;
}
export default function StripeCheckout({publishableKey,clientSecret,onUpdate}){
  const container=useRef(null),callback=useRef(onUpdate),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
  callback.current=onUpdate;
  useEffect(()=>{
    let active=true,session;const host=container.current;
    const updated=()=>{if(active)callback.current?.();};
    setError('');setLoading(true);
    (async()=>{
      await loadScript('https://js.stripe.com/dahlia/stripe.js');
      await loadScript('https://crypto-js.stripe.com/crypto-onramp-outer.js');
      if(!active)return;
      if(!window.StripeOnramp)throw new Error('The secure payment screen is unavailable. Please try again.');
      session=window.StripeOnramp(publishableKey).createSession({clientSecret,appearance:{theme:'light'}});
      session.addEventListener('onramp_session_updated',updated);
      session.mount(host);setLoading(false);
    })().catch(e=>{if(active){setError(e.message);setLoading(false);}});
    return()=>{active=false;session?.removeEventListener?.('onramp_session_updated',updated);host.replaceChildren();};
  },[publishableKey,clientSecret,attempt]);
  return <>{loading&&<p role="status">Opening secure payment…</p>}{error&&<div role="alert"><p>{error}</p><button className="secondary" onClick={()=>setAttempt(n=>n+1)}>Reload payment screen</button></div>}<div className="stripe-checkout" ref={container}/></>;
}
