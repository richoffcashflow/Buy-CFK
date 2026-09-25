import {PublicKey} from '@solana/web3.js';

export function stripeConfiguration(env=process.env){
  const secret=env.STRIPE_SECRET_KEY?.trim()||'',publishable=env.STRIPE_PUBLISHABLE_KEY?.trim()||'';
  const secretMode=/^sk_(live|test)_[A-Za-z0-9]+$/.exec(secret)?.[1]||null;
  const publishableMode=/^pk_(live|test)_[A-Za-z0-9]+$/.exec(publishable)?.[1]||null;
  return {secretKey:secretMode?'configured':secret?'invalid_format':'missing',mode:secretMode,publishableKey:publishableMode?'configured':publishable?'invalid_format':'missing',matchingModes:Boolean(secretMode&&secretMode===publishableMode)};
}
export function validFeeRecipient(address){
  try{return typeof address==='string'&&address!=='11111111111111111111111111111111'&&new PublicKey(address).toBase58()===address&&PublicKey.isOnCurve(new PublicKey(address).toBytes());}catch{return false;}
}
export function stripeReady(env=process.env){
  return env.STRIPE_ONRAMP_ENABLED==='true'&&stripeConfiguration(env).matchingModes&&validFeeRecipient(env.PLATFORM_FEE_WALLET)&&/^whsec_\S+$/.test(env.STRIPE_ONRAMP_WEBHOOK_SECRET||'');
}
