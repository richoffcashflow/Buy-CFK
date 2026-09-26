import {checkStripeOnramp} from '../server/stripe-onramp.mjs';
import {checkStripeComponents} from '../server/stripe-components-readiness.mjs';
console.log('CFK_STRIPE_ONRAMP_CHECK',JSON.stringify(await checkStripeOnramp()));
console.log('CFK_STRIPE_COMPONENTS_CHECK',JSON.stringify(await checkStripeComponents()));
// Read-only diagnostics. Quote access does not prove OAuth or payment access.
