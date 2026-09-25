import test from 'node:test';
import assert from 'node:assert/strict';
import {checkStripeOnramp,stripeConfiguration} from '../server/stripe-onramp.mjs';

const env={STRIPE_SECRET_KEY:'sk_test_fixtureONLY',STRIPE_PUBLISHABLE_KEY:'pk_test_fixtureONLY'};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
const quote={livemode:false,destination_network_quotes:{solana:[{destination_currency:'sol',destination_network:'solana',destination_amount:'0.1'}]}};

test('missing or wrong credential type does not send a request',async()=>{
  const fetchImpl=()=>{throw new Error('must not call Stripe');};
  assert.equal((await checkStripeOnramp({env:{},fetchImpl})).secretKey,'missing');
  assert.equal((await checkStripeOnramp({env:{STRIPE_SECRET_KEY:'lwl_client_secret'},fetchImpl})).secretKey,'invalid_format');
  assert.equal(stripeConfiguration({...env,STRIPE_PUBLISHABLE_KEY:'pk_live_other'}).matchingModes,false);
});

test('onramp check uses a fixed Stripe origin and GET without customer data',async()=>{
  let calls=0;
  const report=await checkStripeOnramp({env,fetchImpl:async(url,options)=>{
    calls++;
    const parsed=new URL(url);assert.equal(parsed.origin,'https://api.stripe.com');
    assert.equal(parsed.pathname,'/v1/crypto/onramp_quotes');
    assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');
    assert.equal(parsed.searchParams.get('destination_currencies[]'),'sol');
    assert.equal(parsed.searchParams.get('destination_networks[]'),'solana');
    assert.equal(parsed.searchParams.get('source_amount'),'20');
    assert.equal(options.headers.Authorization,`Bearer ${env.STRIPE_SECRET_KEY}`);
    return response(quote);
  }});
  assert.equal(calls,1);assert.equal(report.quoteAccess,'available');assert.equal(report.matchingModes,true);
  assert.equal(JSON.stringify(report).includes(env.STRIPE_SECRET_KEY),false);
});

test('errors never leak upstream messages, keys, or arbitrary error codes',async()=>{
  const secret=env.STRIPE_SECRET_KEY;
  const report=await checkStripeOnramp({env,fetchImpl:async()=>response({error:{code:secret,message:secret}},401)});
  assert.equal(report.quoteAccess,'rejected');assert.equal(report.httpStatus,401);
  assert.equal(JSON.stringify(report).includes(secret),false);
  const failed=await checkStripeOnramp({env,fetchImpl:async()=>{throw new Error(secret);}});
  assert.equal(failed.quoteAccess,'connection_failed');assert.equal(JSON.stringify(failed).includes(secret),false);
});

test('legacy quote path is tried only for 404; incorrect mode or asset is rejected',async()=>{
  const paths=[];
  const report=await checkStripeOnramp({env,fetchImpl:async url=>{paths.push(new URL(url).pathname);return paths.length===1?response({},404):response(quote);}});
  assert.deepEqual(paths,['/v1/crypto/onramp_quotes','/v1/crypto/onramp/quotes']);assert.equal(report.quoteAccess,'available');
  assert.equal((await checkStripeOnramp({env,fetchImpl:async()=>response({...quote,livemode:true})})).quoteAccess,'mode_mismatch');
  assert.equal((await checkStripeOnramp({env,fetchImpl:async()=>response({livemode:false,destination_network_quotes:{solana:[]}})})).quoteAccess,'no_sol_quote');
});
