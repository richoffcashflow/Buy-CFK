# Buy $CFK

One simple Cashflowkey coin page for **Free Crypto App LLC**. Blue, black, and white Cashflow branding; background Privy accounts; a fixed amount selector with $20/$50/$100/custom choices and Buy/Sell buttons; matching actions under the graph; your position below the graph; price chart; 24-hour change; market cap; holders; recent coin activity; and risk, fee, terms, and privacy disclosures.

## Current status

The implementation builds locally. This is **not a live money service yet**. `TRADING_ENABLED` and `RAMP_ENABLED` default to `false`. Configure the new project's database, Privy app, market data, and approved payment provider before enabling them. An unconfigured integration returns an explicit unavailable message; the page never substitutes invented prices, holders, trades, or purchase conversions.

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

Create/configure the Privy app: embedded Solana wallets, email login, Telegram seamless authentication, the Telegram bot, and the exact allowed web/mini-app origins. Set `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `PRIVY_VERIFICATION_KEY` on Vercel. Private keys remain in the user-authorized wallet flow.

Set a production `SOLANA_RPC_URL` and `BIRDEYE_API_KEY`. PumpPortal’s Local Transaction API builds an unsigned buy/sell transaction without a Lightning wallet or API key. The app validates and simulates it, Privy signs it, and the server stores its signature before broadcasting. Verify a CFK buy and sell route, liquidity, quote, network reserve, and wallet signing before setting `TRADING_ENABLED=true`. A buy requires finalized on-chain confirmation matching the server-prepared transaction and actual CFK balance movement.

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

1. Vercel, a separate Supabase database, and the scheduled worker are provisioned. Verify all remaining production secrets.
2. Privy app/domain/Telegram setup and a verified CFK data and trading route.
3. Approved on/off-ramp provider supporting embedded checkout, Solana funding/payout, and the disclosed 15% fee in both directions. See [the provider adapter contract](docs/provider-adapter.md).
4. Ad account IDs/credentials, test-event verification, and company approval of the legal copy and fees.
5. End-to-end sandbox and controlled live verification of buy, partial buy, sell, cash payout, rejected wallet signatures, delayed webhooks, consent withdrawal, and duplicate provider notifications.

Do not turn on real-money flags until those dependencies are verified. The app cannot manufacture provider support or live credentials.

## Simple purchase flow

The default is Buy $20. A compact blue-and-black Cashflowkey header introduces the coin without replacing the fixed amount selector. Below activity, a short About section explains CFK and the Creator card uses the user's original IMG_1520.JPG photo. The creator's YouTube, Instagram, X, and TikTok profiles appear in a Creator card below Coin Activity with locally hosted Simple Icons brand SVGs. A customer signs in through Telegram or email, reviews the payment fees, and completes embedded checkout. Verified funding triggers the CFK purchase automatically. One payment has one order; a refresh resumes the same signed transaction. Sell uses a dollar amount and then offers Withdraw. Cash payouts still require the approved provider. The main page never displays a SOL balance or wallet controls.

### Wallet creation and cost controls

Automatic wallet creation is off for both Ethereum and Solana. Browsing and choosing an amount never mount Privy, including for returning funded users. Privy activates only after an explicit sign-in, account action, available Buy action, or payment recovery tap. Pending payments remain saved and offer a recovery button instead of automatically signing in. Cancelling sign-in unmounts the provider. Signing in, viewing a position, and attempting to sell from an empty account do not create wallets.

Before creating a Solana funding address, the app checks payment availability and calls the authenticated `/api/ramp/preflight` endpoint to validate the session, amount, and server payment configuration. Only then does it explicitly create the wallet if needed. Concurrent creation attempts share one request, existing wallets are reused, and cancelled attempts can be retried.

The current on-ramp adapter requires a destination wallet address when it creates checkout, so this integration must create the address **before** payment completes. Creating a wallet only after successful payment requires an approved provider that supports a delayed destination or post-payment fulfillment; that capability is not currently connected.

There is no automatic user or wallet deletion on abandonment. Privy's [standard pricing](https://www.privy.io/pricing) counts authenticated users with an active session in the last 30 days, including users without funded wallets. Deleting an account must not be assumed to erase billing activity. Privy's [user deletion API](https://docs.privy.io/user-management/users/managing-users/deleting-users) archives and disassociates wallets instead of deleting them, and restoring access is not guaranteed. Pending payments and existing funded accounts retain their identity and address.

`TELEGRAM_BOT_TOKEN` is server-only. `TELEGRAM_BOT_USERNAME` has no `@`. Both also need to be configured with the matching Telegram bot in Privy.

### Marketing domain and Telegram

External visits to the root of `buycfk.com` or `www.buycfk.com` automatically open `https://t.me/Cashflowkeybot?startapp=buycfk&mode=fullscreen` after allowing Telegram initialization to finish. A visible Open in Telegram button and Continue in browser fallback remain available. Valid incoming `startapp` or `ref` values are retained in the Telegram link. The browser fallback retains the original query string. No Privy provider is loaded by the launcher. Existing Telegram context, account callback parameters, and non-root paths skip the handoff. Keep BotFather's Mini App URL and menu URL pointing to `https://buy-cfk.vercel.app/`, the existing approved authentication/API origin, to avoid a launch loop or changing account origins.

## Route verification status

On September 24, 2026 the public PumpPortal Local endpoint returned an unsigned transaction for CFK. Its current response uses a wrapper program not documented in the official Pump.fun IDL. The validator deliberately rejects that route until its instruction format is verified; do not enable real-money flags on the strength of the unsigned response alone. Direct Pump.fun/Pump AMM instructions are parsed, but a funded simulation and a controlled signing check are still launch gates. Provider payment requests for automatic buys are blocked while `TRADING_ENABLED` is false.

The unlinked, no-index `/layout-preview.html` page renders the real app at two mobile sizes for layout verification.

Sources: [PumpPortal Local API](https://pumpportal.fun/local-trading-api/trading-api/), [PumpPortal fees](https://pumpportal.fun/fees/), [Pump.fun protocol IDLs](https://github.com/pump-fun/pump-public-docs), [Solana account queries](https://solana.com/docs/rpc/http/getprogramaccounts).

Sign-in is explicitly available in Telegram as well as the browser, with an email retry if Telegram authentication fails. The app releases its own dialog before opening Privy and keeps transaction dialogs below provider overlays. In Privy, enable **Telegram** itself as well as **seamless Mini App login**; the seamless checkbox alone does not enable Telegram authentication.
