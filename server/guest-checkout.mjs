// Enable this rollout only after Guest accounts and email login are configured
// in Privy. The SDK still enforces Privy's actual authentication settings.
// Do not scrape the browser configuration endpoint from the server: an upstream
// access restriction must not be reported as an owner-disabled dashboard setting.
export function guestCheckoutEnabled(appId, enabled=process.env.GUEST_CHECKOUT_ENABLED) {
  return Boolean(appId) && enabled === 'true';
}
