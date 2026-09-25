// This file only activates on the dedicated Stripe Preview branch.
export const isSandbox=()=>process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='stripe-sandbox';
export const sandboxOrigin='https://buy-cfk-git-stripe-sandbox-cashflowkey.vercel.app';
export function configureSandbox(env=process.env){
  if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='stripe-sandbox')return;
  if(!/^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY?.trim()||'')||!/^pk_test_[A-Za-z0-9]+$/.test(env.STRIPE_PUBLISHABLE_KEY?.trim()||'')||!/^whsec_\S+$/.test(env.STRIPE_ONRAMP_WEBHOOK_SECRET||''))throw new Error('Sandbox requires test Stripe keys and its own webhook secret.');
  env.APP_URL=sandboxOrigin;
  env.STRIPE_ONRAMP_ENABLED='true';env.TRADING_ENABLED='true';env.RAMP_ENABLED='false';
  env.PLATFORM_FEE_WALLET='GCSMVSukYak5KmmF5jU9XAb9xP1cd689m8UpUm5zbUNz';
}
configureSandbox();
