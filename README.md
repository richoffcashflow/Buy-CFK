# Buy $CFK

One simple Cashflowkey coin page for **Free Crypto App LLC**. Blue, black, and white Cashflow branding; Privy Solana wallets; Buy/Sell; amount presets; wallet position; price chart; 24-hour change; market cap; holders; recent coin activity; and risk, fee, terms, and privacy disclosures.

## Current status

The implementation builds locally. This is **not a live money service yet**. `TRADING_ENABLED` and `RAMP_ENABLED` default to `false`. Configure the new project's database, Privy app, market data, and approved payment provider before enabling them. An unconfigured integration returns an explicit unavailable message; the page never substitutes invented prices, holders, trades, or purchase conversions.

CFK mint, taken from the existing Free Crypto App source:

`3Rcko4DWwbLQP6vZ2Juxy3gDbv3omNkeg5np17fbpump`

The current public DexScreener lookup has no indexed main pair for this mint. Chart, price, and activity therefore remain unavailable until a verified pool is indexed or a suitable provider is connected. Holder count requires a Birdeye API key. Confirm the mint and liquidity route before launch.

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

Import `richoffcashflow/Buy-CFK` as a **new** Vercel project, using the Vite preset, build `npm run build`, output `dist`, and Node 22+. The Vercel API is `api/index.js` with routes in `vercel.json`.

Provision a separate PostgreSQL database (Supabase is supported). Put its server connection or transaction-pooler URL in `DATABASE_URL`, with the provider's required TLS settings. Run `npm run db:migrate` against that database. Database access is server-only; no Supabase anonymous key or direct browser table access is used. The schema enables row-level security without public policies on all application tables. Use the server owner role for migrations and application access.

Set `APP_URL` to the new production origin and a random `CRON_SECRET`. The five-minute `/api/jobs` schedule needs a Vercel plan that supports that frequency, or an authenticated external scheduler. This worker reconciles submitted transactions and payments and retries conversion delivery. Do not disable it for a launch with measurement enabled.

Create/configure the Privy app: embedded Solana wallets, email login, Telegram seamless authentication, the Telegram bot, and the exact allowed web/mini-app origins. Set `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `PRIVY_VERIFICATION_KEY` on Vercel. Private keys remain in the user-authorized wallet flow.

Set a production `SOLANA_RPC_URL`, `JUPITER_API_KEY`, and `BIRDEYE_API_KEY`. Verify a CFK buy and sell route, liquidity, quote, network reserve, and wallet signing before setting `TRADING_ENABLED=true`. A buy requires finalized on-chain confirmation matching the server-prepared transaction and actual CFK balance movement.

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
| Purchase | The CFK buy is finalized and verified by the server | Actual settled on-ramp fee allocated to the funds spent |
| WithdrawalFee | The provider confirms the cash payout and fee settlement | Actual settled off-ramp fee; separate from Purchase |

A $100 deposit with a $15 settled fee allocates that $15 across the funded SOL as it is spent on confirmed buys. A half-spend reports half of that fee; the final spend receives the rounding remainder. External-wallet-funded purchases have $0 app fee revenue. The app never reports the entire coin purchase amount as revenue. Concurrent confirmations serialize by wallet, and transaction/event IDs make retries idempotent.

Google/YouTube, Meta, TikTok, X, and OpenAI integrations are included. Set the account-specific IDs and server credentials in `.env.example`; configure each account's conversion actions. Browser/server copies share receipt IDs. Google Ads and GA4 use one configured purchase delivery path to avoid double counting. OpenAI amounts use integer cents; other USD value fields use dollars.

A PostgreSQL outbox stores server events and retries transient delivery failures. The scheduled worker is required; unconfigured platforms do not receive events. Ad tracking is consent-gated and respects Global Privacy Control. Campaign and click identifiers survive wallet/payment steps through an opaque first-party session. Never put names, emails, or card data into campaign parameters.

## Remaining launch dependencies

1. New Vercel project and separate PostgreSQL database, with environment configuration and scheduled worker.
2. Privy app/domain/Telegram setup and a verified CFK data and trading route.
3. Approved on/off-ramp provider supporting embedded checkout, Solana funding/payout, and the disclosed 15% fee in both directions. See [the provider adapter contract](docs/provider-adapter.md).
4. Ad account IDs/credentials, test-event verification, and company approval of the legal copy and fees.
5. End-to-end sandbox and controlled live verification of buy, partial buy, sell, cash payout, rejected wallet signatures, delayed webhooks, consent withdrawal, and duplicate provider notifications.

Do not turn on real-money flags until those dependencies are verified. The app cannot manufacture provider support or live credentials.
