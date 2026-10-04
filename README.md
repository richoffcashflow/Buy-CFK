# Buy $CFK

One simple Cashflowkey coin page for **Free Crypto App LLC**. Blue, black, and white Cashflow branding; background Privy accounts; a fixed amount selector with $20/$50/$100/custom choices and Buy/Sell buttons; matching actions under the graph; your position below the graph; price chart; 24-hour change; market cap; holders; recent coin activity; and risk, fee, terms, and privacy disclosures.

## Current status

The implementation builds locally. `TRADING_ENABLED` and `RAMP_ENABLED` default to `false` in an unconfigured checkout; deployed settings can differ. On October 1, 2026, the production public configuration reported buying enabled and cash withdrawals disabled. This is an observed configuration state, not proof of completed real-money end-to-end verification. Configure the new project's database, Privy app, market data, and approved payment provider before enabling them. An unconfigured integration returns an explicit unavailable message; the page never substitutes invented prices, holders, trades, or purchase conversions.

CFK mint, confirmed by the owner’s Pump.fun link:

`3Rcko4DWwbLQP6vZ2Juxy3gDbv3omNkeg5np17fbpump`

This coin is on its Pump.fun bonding curve. Prices and activity fall back to verified on-chain curve reserves and trade events when no indexed pool exists. The app keeps actual USD price samples for 1H/1D/1W/1M/All charts. Touch inspection uses actual timestamps, updates the headline price, and retains the selected price after a finger is lifted. Longer views sample actual observations and never invent history; 24-hour change requires an observed comparison point. Holder count uses Birdeye when configured or verified funded token owners from the chain, including protocol accounts. The exact coin image was downloaded from its immutable Token-2022 metadata URI.

## Run

Node 22 or later:

```sh
npm ci
cp .env.example .env.local
# Populate configuration securely; do not commit credentials.
node --env-file=.env.local scripts/migrate.mjs
node --env-file=.env.local scripts/dev.mjs
```

Open http://localhost:4173. `npm test` checks fee accounting, payment signatures, conversion units, and confirmed trade idempotence using a local PostgreSQL engine with simulated blockchain responses. `npm run build` builds the frontend. Test fixtures never appear in the product or contact advertising accounts.

## Vercel and database setup

The `buy-cfk` Vercel project is connected to `richoffcashflow/Buy-CFK` and deploys at https://buy-cfk.vercel.app. It uses the Vite preset, build `npm run build`, output `dist`, and Node 22+. The Vercel API is `api/index.js` with routes in `vercel.json`.

Provision a separate PostgreSQL database (Supabase is supported). Put its server connection or transaction-pooler URL in `DATABASE_URL`, with the provider's required TLS settings. Run `npm run db:migrate` against that database. Database access is server-only; no Supabase anonymous key or direct browser table access is used. The schema enables row-level security without public policies on all application tables. Use the server owner role for migrations and application access.

Set `APP_URL` to the new production origin and a random `CRON_SECRET`. The current Vercel workspace is on Hobby, so `vercel.json` intentionally has no cron schedule. For production, schedule authenticated `/api/jobs` calls at least every five minutes using Supabase Cron, or run `npm run worker` on a persistent Railway service with the same server environment. Vercel Pro can alternatively schedule `/api/jobs` every five minutes. The worker reconciles submitted transactions and payments and retries conversion delivery. Supabase Cron is provisioned to call `/api/jobs` every five minutes using a Vault-held secret. Do not disable it for a launch with measurement enabled.

Create/configure the Privy app with Guest accounts, email login, and the exact website origins. Keep automatic wallet creation off; Solana wallets are created explicitly at checkout. All visible sign-in and account recovery use email. Existing authenticated accounts can link an email without replacing their identity or wallet. Set `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `PRIVY_VERIFICATION_KEY` on Vercel. Private keys remain in the user-authorized wallet flow.

Set a production `SOLANA_RPC_URL` and `BIRDEYE_API_KEY`. Pump’s official transaction service builds unsigned buy/sell transactions with integer atomic amounts. The app validates and simulates it, Privy signs it, and the server stores its signature before broadcasting. Verify a CFK buy and sell route, liquidity, quote, network reserve, and wallet signing before setting `TRADING_ENABLED=true`. A buy requires finalized on-chain confirmation matching the server-prepared transaction and actual CFK balance movement.

## Fees and tracking

- Adding money: **15% of gross USD**, plus disclosed provider costs.
- Cashing out: **15% of gross USD**, plus disclosed provider costs.
- Example: $100 gross means $15 platform fee and $85 net before provider/network costs.
- There is no additional 15% fee on each wallet swap.
- A deposit does not count as a coin purchase; a coin sale does not count as a paid cash withdrawal.

| Event | Trigger | Conversion value |
| --- | --- | --- |
| ViewContent | The coin page is viewed with measurement consent | $0 |
| InitiateCheckout | Buy pressed, or a verified deposit settles | $0; same journey deduplicates |
| Purchase | The CFK buy is finalized and verified by the server | Actual settled on-ramp fee attributable to the verified purchase |
| WithdrawalFee | The provider confirms the cash payout and fee settlement | Actual settled off-ramp fee; separate from Purchase |

A $20 automatic purchase reports the verified $3 platform fee once the CFK buy is finalized. The fee is attached to that payment, so unused trading reserves cannot generate a second fee conversion. Legacy partial funded trades allocate their fee proportionally with exact integer rounding. External-wallet-funded purchases have $0 app fee revenue. The app never reports the entire coin purchase amount as revenue. Concurrent confirmations serialize by wallet, and transaction/event IDs make retries idempotent.

Google/YouTube, Meta, TikTok, X, and OpenAI integrations are included. Set the account-specific IDs and server credentials in `.env.example`; configure each account's conversion actions. Browser/server copies share receipt IDs. Google Ads and GA4 use one configured purchase delivery path to avoid double counting. OpenAI amounts use integer cents; other USD value fields use dollars.

A PostgreSQL outbox stores server events and retries transient delivery failures. The scheduled worker is required; unconfigured platforms do not receive events. Ad tracking is consent-gated and respects Global Privacy Control. Campaign and click identifiers survive wallet/payment steps through an opaque first-party session. Never put names, emails, or card data into campaign parameters.

## Remaining launch dependencies

### Stripe connection check

Set `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` in Vercel using API keys from the same Stripe account and mode (`sk_live_`/`pk_live_` or test equivalents). The mobile embedded-component App ID/client credentials are different. Do not expose the secret to Vite or commit it.

`npm run check:stripe` (also part of each build) makes a read-only SOL/USD quote request to Stripe. The `CFK_STRIPE_ONRAMP_CHECK` build log reports credential format, key modes, publishable-key presence, and quote access. It never logs secret values, upstream error text, customer data, or checkout client secrets. The check creates no payment sessions and moves no money. Failure is informational so the public coin page stays online.

This is a connection diagnostic, **not an activated Stripe checkout**. Stripe's source amount can be changed in its widget, and its quote API distinguishes the source amount from the total including provider fees. Before wiring automatic CFK buys, implement verified session reconciliation for the actual delivered asset and amount, signed onramp notifications, and the agreed platform-fee collection method. The current generic adapter requires evidence of a settled 15% fee; a Stripe quote alone cannot provide it. Off-ramp support and CFK route simulation/signing remain separate launch dependencies. Neither `RAMP_ENABLED` nor `TRADING_ENABLED` is changed by this check.

References: [Stripe web onramp](https://docs.stripe.com/crypto/onramp/embedded), [quote API](https://docs.stripe.com/api/crypto/onramp_quotes/retrieve), [session parameters](https://docs.stripe.com/api/crypto/onramp_sessions/create).

1. Vercel, a separate Supabase database, and the scheduled worker are provisioned. Verify all remaining production secrets.
2. Privy Guest accounts, email login, and website-origin setup and a verified CFK data and trading route.
3. Approved on/off-ramp provider supporting embedded checkout, Solana funding/payout, and the disclosed 15% fee in both directions. See [the provider adapter contract](docs/provider-adapter.md).
4. Ad account IDs/credentials, test-event verification, and company approval of the legal copy and fees.
5. End-to-end sandbox and controlled live verification of buy, partial buy, sell, cash payout, rejected wallet signatures, delayed webhooks, consent withdrawal, and duplicate provider notifications.

Do not turn on real-money flags until those dependencies are verified. The app cannot manufacture provider support or live credentials.

## Simple purchase flow

The default is Buy $20. Choose $20, $50, $100, or type a custom amount directly, then press Buy. These are the two app actions before payment; Stripe may require payment details, identity verification, or bank approval. A new buyer receives a background guest session without entering an email or using Telegram. After verified funding and the CFK purchase, Save my account upgrades that same guest identity using email. Existing buyers can sign in separately. The creator card retains the original photo and links only to the creator’s Instagram, @cashflowkeyy. The blue check beside $CFK identifies the official Cashflowkey token.

Verified funding triggers the CFK purchase automatically while the checkout is open. One payment has one order. Visiting or refreshing the page never opens checkout or starts a payment automatically; saved payments offer Continue payment or trade. Sell opens a review before signing and limits the initial selection to the position's value. Sale proceeds remain in SOL; cash payouts require a separately approved and enabled provider.

**Guest checkout configuration:** enable Guest accounts and email login in the same Privy app, then set server-side `GUEST_CHECKOUT_ENABLED=true` for the deployment. It defaults to disabled. The owner confirmed enabling Guest accounts on October 3, 2026 (America/Chicago). `/api/config` reports this explicit rollout setting; it does not claim to inspect the provider dashboard. Privy still enforces guest creation and email linking through its SDK, and provider rejection stops before funding or wallet creation. Verify the checkout on the approved website origin. See [the checkout audit](docs/checkout-audit-2026-10-03.md).

### Wallet creation and cost controls

Automatic wallet creation is off for both Ethereum and Solana. First-time browsing and choosing an amount do not mount Privy; amount interaction can preload its code. Returning users can restore their existing session quietly. Otherwise Privy activates after an explicit account action or available Buy action. A recent Buy intent retains its amount in the same tab for ten minutes, but a fresh Buy tap is required after refresh. Unresolved payments retain their separate durable recovery reference. Cancelling sign-in preserves an existing authenticated session. Signing in, viewing a position, and attempting to sell from an empty account do not create wallets.

Before creating a Solana funding address, the app checks payment availability and calls the authenticated `/api/ramp/preflight` endpoint to validate the session, amount, and server payment configuration. Only then does it explicitly create the wallet if needed. Concurrent creation attempts share one request, existing wallets are reused, and cancelled attempts can be retried.

The current on-ramp adapter requires a destination wallet address when it creates checkout, so this integration must create the address **before** payment completes. Creating a wallet only after successful payment requires an approved provider that supports a delayed destination or post-payment fulfillment; that capability is not currently connected.

There is no automatic user or wallet deletion on abandonment. Privy's [standard pricing](https://www.privy.io/pricing) counts authenticated users with an active session in the last 30 days, including users without funded wallets. Deleting an account must not be assumed to erase billing activity. Privy's [user deletion API](https://docs.privy.io/user-management/users/managing-users/deleting-users) archives and disassociates wallets instead of deleting them, and restoring access is not guaranteed. Pending payments and existing funded accounts retain their identity and address.

### Website and older accounts

`buycfk.com`, `www.buycfk.com`, and `buy-cfk.vercel.app` render the app directly. The Telegram redirect and blocking Telegram SDK are removed. The API accepts these exact verified production aliases when `APP_URL` is one of them; arbitrary origins and unrelated previews remain rejected. Configure an isolated preview's own `APP_URL` to test authenticated POST routes there. Explicit `?checkout_test=stripe` sandbox links retain their fixed allowlisted destination. Legacy Telegram launch parameters no longer redirect the site.

Browser sessions are scoped to their origin. The site contains no Telegram SDK, links, sign-in option, or Telegram session handoff. A funded authenticated account without email can add one to the same identity and wallet. Older holders who cannot access their session are directed to support; changing login methods does not automatically merge or migrate their accounts. New purchases use guest checkout, followed by email recovery. Privy guest sessions last 30 days; a funded guest is prompted to save access, and the app never logs it out or deletes it after a failed upgrade. Privy does not merge a guest into an existing account, so an already-used email may require a different email for that purchase.

## Route verification status

On September 25, 2026 the official `https://fun-block.pump.fun/agents/swap` endpoint returned a CFK buy using the direct Pump program, one signer, and no lookup table. It replaces PumpPortal's unsupported wrapper route. The same mint, owner, instruction, amount, simulation, and atomic admin fee checks still apply; no wrapper program has been allowlisted. A funded simulation and a controlled wallet-signing check remain launch gates. Provider payment requests for automatic buys are blocked while `TRADING_ENABLED` is false.

The unlinked, no-index `/layout-preview.html` page renders the real app at two mobile sizes for layout verification.

Sources: [Pump transaction API](https://github.com/pump-fun/pump-fun-skills/tree/main/swap), [Pump.fun protocol IDLs](https://github.com/pump-fun/pump-public-docs), [Solana account queries](https://solana.com/docs/rpc/http/getprogramaccounts).

Returning-user sign-in uses email. The app releases its own dialog before opening Privy, keeps transaction dialogs below provider overlays, and does not time out while someone is reading an email. Sign-in offers email only. Telegram bot configuration itself is managed separately and was not changed by this code update.


### Stripe embedded onramp

Stripe funding is implemented but disabled until activation. Keep `STRIPE_ONRAMP_ENABLED=false` and `TRADING_ENABLED=false` until a sandbox checkout and the current CFK route/signing flow have been verified. Stripe does not provide this app's off-ramp; the existing withdrawal adapter remains separately gated.

Required server configuration:

- `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`: matching API key modes from the approved onramp account.
- `STRIPE_ONRAMP_WEBHOOK_SECRET`: signing secret for onramp session notifications sent to `https://buy-cfk.vercel.app/api/stripe/webhook`.
- `PLATFORM_FEE_WALLET`: the owner's admin Privy wallet's **public Solana address**. No private key is required. Do not substitute a creator or token address.
- Register each actual website checkout origin with Stripe, including `https://buycfk.com` and any alternate origin used by customers.

Production builds add and verify the private settlement uniqueness table in the project's configured database. Other environments use `npm run db:migrate`. The public schema enables RLS and has no browser policies.

Checkout creation is idempotent per payment attempt. The funding wallet is locked in Stripe. Client secrets are returned only to the authenticated owner and kept in memory, not browser storage or logs. Payment notifications require Stripe's timestamped HMAC signature; settlement is re-fetched from Stripe and its finalized Solana delivery is verified. Sandbox receipts never authorize mainnet trades. If Stripe's final dollar total exceeds the user's reviewed total, the app requests approval of the updated amount before buying.

The 15% platform fee is based on the actual gross fiat payment, converted using the actual funding exchange rate, and transferred to the captured admin address in the **same transaction** as the CFK purchase. The complete transaction is simulated and must fit Solana's size limit. Failed purchases do not collect this fee. The confirmed recipient balance and transfer are checked before recording fee revenue or a Purchase event. Purchase value is earned platform fee revenue, not payment volume. Changing the configured admin wallet does not reroute existing checkouts.

Known activation gate: validate the complete current route with a funded simulation and controlled wallet signing before enabling live funding. Real payment, signing, KYC, and payout flows have not been exercised by the automated fixtures.


## October 2026 account recovery and home-screen update

- The coin page includes a direct sign-in button. Returning authenticated sessions and the last valid dollar amount can be restored without starting another payment; wallet creation remains on-demand.
- Available balance is held in SOL and displayed in USD. When cash withdrawals are disabled, the page and sell review say so before a sale is signed.
- Sale review shows the amount, estimated proceeds, and price movement allowance. An expired unsigned quote is refreshed for review before signing.
- Unfinished payment references do not expire after 24 hours or disappear on a generic confirmation conflict. The authenticated `GET /api/account/history` endpoint exposes only the signed-in user's most recent 20 payment/trade records and immutable recovery references. Opening history never initiates a trade.
- “Add to Home Screen” is optional and only opens installation help or the browser's installation prompt after a tap. The manifest uses existing CFK artwork, standalone display, and a clean `/` start URL. No service worker, offline payment processing, credential cache, or quote cache is installed. Live prices and account actions need an internet connection.
- Website routing and guest-first checkout are implemented in the October 3 branch, gated on Privy Guest accounts and provider-origin verification. Existing account identities remain supported.

The test suite includes isolated DOM interaction tests. `npm test` runs tests serially to bound concurrent PostgreSQL/WASM memory use. These fixtures do not exercise live payment, wallet signing, KYC, or provider origin configuration.


## Public legal documents

`/privacy` and `/terms` are directly addressable, unauthenticated HTML documents generated from `src/Legal.jsx`. Explicit Vercel rewrites serve them before the app fallback, so marketing-domain legal visits never enter the Telegram launcher. They include return navigation and require no JavaScript or wallet login.

Run `npm run legal:build` after changing the existing legal source. The build also regenerates these pages, and a regression test checks that the committed static documents match the source. Deploying the files is required before publishing these paths in partner applications; local existence alone does not make a URL live.
