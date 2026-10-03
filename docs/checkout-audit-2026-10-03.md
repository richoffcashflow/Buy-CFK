# Checkout audit — October 3, 2026

The requested experience is the BuyCFK website: choose an amount, press Buy, pay, then save the account with email. The two-click target describes the app's entry into checkout. Provider payment details, identity checks, and bank approvals can add required actions.

## Changes

| Finding | Change |
| --- | --- |
| Branded-domain visits left the website for Telegram | Render the app on the website; remove the blocking Telegram SDK and automatic handoff. |
| New buyers had to authenticate before checkout | Create a guest session after an explicit Buy action; prompt for email after funding/purchase. Retain the same user and wallet when upgrading. |
| Custom amounts required a separate dialog | Accept an inline decimal amount with validation and an amount-specific Buy button. |
| Exact `APP_URL` comparison rejected other verified production aliases | Allow only the three verified HTTPS production origins when configured for that deployment. |
| A slow email login could be interrupted by the app timeout | Keep provider-loading timeouts, but let the user finish email authentication. |
| Network requests could remain pending indefinitely or treat an HTML response as success | Bound API requests, reject malformed responses, and never automatically retry payment POST requests. |
| A position below $20 could not use the default Sell selection | Clamp the initial sale amount to the current position value and preserve explicit sale confirmation. |
| A refresh during guest connection lost the selected purchase | Preserve the chosen amount in tab storage for ten minutes, then wait for a fresh Buy tap. Existing payment recovery remains durable. |
| Price refresh failures were silent | Label stale prices and provide a retry for checkout configuration failures. |
| Email upgrade failure could make Retry do nothing | Retry the email upgrade on the existing guest session without creating another payment. |
| The chart captured vertical touch gestures | Permit vertical page scrolling and pinch zoom while retaining horizontal price inspection. |
| Returning users could have checkout opened automatically | Restore accounts quietly, keep payment recovery behind Continue, and poll checkout only while its dialog is open. |

The follow-up adds a blue Official CFK checkmark beside the coin symbol and Instagram, TikTok, and YouTube links at the bottom. Social destinations were cross-checked against [the creator's Linktree](https://linktr.ee/cashflowkey); its TikTok destination is `@cashflowkey`. The badge identifies this project's official token; it does not assert third-party endorsement.

## Wallet and payment boundaries

- Browsing, choosing an amount, and restoring an empty account create no wallet.
- A Buy action establishes identity, then calls authenticated funding preflight. Only a ready checkout can request an on-demand Solana wallet.
- Stripe requires the destination address before accepting payment, so wallet creation happens at checkout, before funding completes.
- Existing idempotent payment attempts, verified provider receipts, finalized transaction checks, and durable recovery references remain in place.
- Failed account upgrade keeps the funded guest identity intact. Email addresses already associated with another account cannot be merged into a guest by Privy.
- Bridge has not been integrated. Cash withdrawals remain governed by the existing disabled provider flag.

## Verification and release status

All 56 tests pass and `npm run build` succeeds locally. Automated DOM tests exercise amount selection, guest connection, payment verification, automatic coin purchase, account upgrade/retry, quiet refresh/account restoration, deliberate payment recovery, disabled guest checkout, sale review, and older payment recovery. Payment, Privy, and chain responses in these tests are fixtures, not live transactions. Existing server tests cover authentic payment signatures, fee accounting, duplicate settlement, and confirmed trade idempotence.

Vercel preview `cfk-iyn708fc6-cashflowkey.vercel.app` built successfully from commit `ec8c6f4`. Browser checks confirmed desktop rendering, inline custom amount entry, and the 375 × 667 layout with no horizontal overflow. Preview configuration reports buying and guest checkout disabled, so verification stopped before creating an identity or payment. The browser console showed extension-origin metadata errors, but no application-origin errors during these checks.

![Mobile preview with an inline custom amount; preview buying is disabled](checkout-preview-20261003.jpg)

On October 3, the production public app configuration reported buying enabled and withdrawals disabled. Privy's public app configuration reported email authentication enabled and guest authentication disabled. No provider settings, live balances, or real-money transactions were changed during this audit.

The branch must stay out of production until Guest accounts is enabled in Privy's dashboard and guest checkout plus email upgrade is verified on the actual approved website origin. `/api/config` checks both guest and email support with a short cache; an unavailable check blocks new guest creation. Existing authenticated accounts can still access their balances and recover payments.

Validate a controlled provider test checkout before promotion. The local suite and build do not establish live KYC, card authorization, wallet signing, funded route execution, or cash-payout readiness. The wallet SDK remains a large deferred bundle; it is preloaded on amount interaction instead of during initial browsing.

References: [Privy guest accounts](https://docs.privy.io/authentication/user-authentication/login-methods/guest), [Stripe embedded onramp](https://docs.stripe.com/crypto/onramp/embedded), [Bridge USD payout methods](https://apidocs.bridge.xyz/get-started/guides/move-money/usd-integration-guide).
