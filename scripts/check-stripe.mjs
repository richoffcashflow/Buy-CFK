import {checkStripeOnramp} from '../server/stripe-onramp.mjs';

const report=await checkStripeOnramp();
console.log('CFK_STRIPE_ONRAMP_CHECK',JSON.stringify(report));
// Informational only: a missing/unapproved onramp must not take the coin page
// offline. Real-money flags remain separately disabled until end-to-end review.
