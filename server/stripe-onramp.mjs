// Server-only, read-only connection check. Never import this module in the browser.
// A successful quote proves quote access, not session approval, fee collection,
// a completed payment, or a working CFK purchase/off-ramp.
const API_ORIGIN='https://api.stripe.com';
const allowedCodes=new Set(['api_key_expired','invalid_api_key','permission_denied','account_invalid','rate_limit','resource_missing','parameter_unknown','parameter_invalid_integer','parameter_invalid_empty','parameter_missing']);

export function stripeConfiguration(env=process.env){
  const secret=env.STRIPE_SECRET_KEY?.trim()||'';
  const publishable=env.STRIPE_PUBLISHABLE_KEY?.trim()||'';
  const secretMode=/^sk_(live|test)_[A-Za-z0-9]+$/.exec(secret)?.[1]||null;
  const publishableMode=/^pk_(live|test)_[A-Za-z0-9]+$/.exec(publishable)?.[1]||null;
  return {secretKey:secretMode?'configured':secret?'invalid_format':'missing',mode:secretMode,publishableKey:publishableMode?'configured':publishable?'invalid_format':'missing',matchingModes:Boolean(secretMode&&secretMode===publishableMode)};
}

export async function checkStripeOnramp({env=process.env,fetchImpl=fetch}={}){
  const configuration=stripeConfiguration(env);
  if(configuration.secretKey!=='configured')return {...configuration,quoteAccess:'not_checked'};
  // This GET requests a SOL price quote only: no wallet, customer, checkout,
  // session, card charge, transfer, or trade is created.
  const query=new URLSearchParams({source_currency:'usd',source_amount:'20','destination_currencies[]':'sol','destination_networks[]':'solana'});
  try{
    const request=path=>fetchImpl(`${API_ORIGIN}${path}?${query}`,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY.trim()}`},signal:AbortSignal.timeout(10000)});
    let response=await request('/v1/crypto/onramp_quotes');
    // Stripe's integration guide also documents this older quote-only path.
    if(response.status===404)response=await request('/v1/crypto/onramp/quotes');
    let data;try{data=await response.json();}catch{return {...configuration,quoteAccess:'invalid_response',httpStatus:response.status};}
    if(!response.ok)return {...configuration,quoteAccess:'rejected',httpStatus:response.status,...(allowedCodes.has(data?.error?.code)?{errorCode:data.error.code}:{})};
    if(data?.livemode!==(configuration.mode==='live'))return {...configuration,quoteAccess:'mode_mismatch',httpStatus:response.status};
    const quote=data?.destination_network_quotes?.solana?.find(q=>q.destination_currency==='sol'&&q.destination_network==='solana'&&Number(q.destination_amount)>0);
    return {...configuration,quoteAccess:quote?'available':'no_sol_quote',httpStatus:response.status};
  }catch{
    // Upstream error text can contain credentials. Emit only a fixed code.
    return {...configuration,quoteAccess:'connection_failed'};
  }
}
