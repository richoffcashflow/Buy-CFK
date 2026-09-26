// Read-only readiness probe. Never creates customers, sessions, or payments.
export async function checkStripeComponents({env=process.env,fetchImpl=fetch}={}){
  const credentials={linkClientId:Boolean(env.LINK_CLIENT_ID),linkClientSecret:Boolean(env.LINK_CLIENT_SECRET),linkScopes:Boolean(env.LINK_OAUTH_SCOPES)};
  if(!/^sk_(live|test)_/.test(env.STRIPE_SECRET_KEY||''))return {...credentials,quoteAccess:'not_checked'};
  const params=new URLSearchParams({ui_mode:'headless',source_amount:'20',source_currency:'usd','destination_currencies[]':'usdc','destination_networks[]':'solana'});
  try{
    const response=await fetchImpl('https://api.stripe.com/v1/crypto/onramp_quotes?'+params,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY.trim(),'Stripe-Version':'2026-08-26.dahlia;crypto_onramp_beta=v2'}
    });
    let data;try{data=await response.json();}catch{return {...credentials,quoteAccess:'invalid_response',httpStatus:response.status};}
    if(!response.ok)return {...credentials,quoteAccess:'rejected',httpStatus:response.status,...(/^[a-z_]{1,80}$/.test(data?.error?.code||'')?{errorCode:data.error.code}:{})};
    const quote=data.destination_network_quotes?.solana?.find(q=>q.destination_currency==='usdc'&&Number(q.destination_amount)>0);
    return {...credentials,quoteAccess:quote?'available':'no_usdc_quote',modeMatches:data.livemode===env.STRIPE_SECRET_KEY.startsWith('sk_live_'),httpStatus:response.status};
  }catch{return {...credentials,quoteAccess:'connection_failed'};}
}
