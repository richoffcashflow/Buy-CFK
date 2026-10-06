# CFK card account — implementation draft

Requested journey: Buy CFK, choose Sell, convert proceeds to USDC with a 15% fee,
then use a CFK card and a full account dashboard. The card stays out of the initial
buying experience. Returning users should buy more CFK directly from USDC. Card
usage, wallet provisioning, balances, statements, and controls belong to Privy's
bank-approved components. Do not describe the app itself as a bank or promise
instant arrival before chain confirmation and provider availability.

## Prepared

- `/card-preview.html`: clearly labeled, interactive design preview with sample
  balances only. Sell review, first-card introduction, account overview, card
  controls, activity, and a buy-from-balance design. No provider or financial calls.
- `src/PrivyCardAccount.jsx`: production Privy component adapter, to mount beneath
  the existing `PrivyProvider` when selecting the card path. Uses the existing
  Solana trading wallet ID, paginates card history, restores active/frozen cards,
  handles cancellation and replacement, and never treats lookup errors as no card.
- `src/card-policy.js`: shared 15% integer USDC fee calculation and card lookup.
  Calculation does not collect a fee.
- `server/card-config.mjs`: production target validation. No guessed merchant
  defaults, sandbox fallback, or secret keys exposed to the client.

## Not live or implemented yet

The preview is deliberately separate from the real trading app. The new card
adapter is not mounted in the production buy/sell flow. Existing trades still
convert CFK to SOL. This draft does not claim a successful card-funded sale.

1. Obtain `CARD_PROGRAM_ID`, `CARD_MERCHANT_ID`, and `CARD_STABLECOIN_ADDRESS`
   from Privy for this production Bridge merchant. User confirmed approval and
   supplied a dashboard screenshot showing Stripe and Bridge enabled in both
   environments. These target values were absent from the application's source
   and Vercel environment variable names when checked.
2. Implement and validate the CFK/SOL-to-USDC conversion, 15% fee collection,
   authenticated quotes, durable idempotency, signed-transaction validation,
   confirmation/recovery, and corresponding USDC-to-CFK purchase path. A USDC
   wallet total is not automatically a card's available-to-spend balance: use
   Privy's card balance and account for card holds before any balance-funded buy.
3. Mount the card adapter in the real app after Sell. Complete card eligibility
   and approval before offering a sale that promises spendable card proceeds.
   Restore account mode from verified card and settled conversion state, scoped
   to the authenticated user. Keep card credentials inside Privy's components.
4. Verify configured gas sponsorship for card approvals and conversion costs;
   run sandbox issuance, decline/cancel/retry, replacement, wallet provisioning,
   hold/balance handling and conversion settlement tests before enabling live use.

Whether the issued card itself can purchase crypto through Stripe Onramp is not
verified. The design instead proposes a direct purchase from available USDC,
which still requires the conversion and balance-reservation integration above.

References reviewed October 4, 2026:
- https://docs.privy.io/financial-flows/cards/pre-built-components/overview
- https://docs.privy.io/financial-flows/cards/pre-built-components/react-integration
- Installed `@privy-io/react-auth` 3.45.0 `/cards` type declarations.
