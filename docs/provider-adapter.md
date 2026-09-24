# Payment provider adapter contract

No ramp provider has been selected or implemented. `server/ramp.mjs` is a gated client for an approved adapter, not a claim that any provider supports these commercial terms. `RAMP_ENABLED=false` until the adapter and settlement flows pass verification.

The adapter must support embedded on-ramp and off-ramp checkout, the exact wallet and Solana network, provider identity checks, allowed jurisdictions, the disclosed 15% platform fee, and actual merchant fee settlement. Never treat a checkout return URL or iframe message as payment confirmation.

`POST {RAMP_ADAPTER_URL}/sessions`, bearer authenticated, receives:

```json
{
  "idempotencyKey": "app-generated UUID",
  "merchantReference": "same UUID",
  "direction": "onramp",
  "wallet": "user-owned Solana address",
  "asset": "SOL",
  "network": "solana",
  "currency": "USD",
  "grossCents": 10000,
  "platformFeeBps": 1500,
  "platformFeeCents": 1500,
  "embed": true,
  "returnUrl": "https://APP_ORIGIN",
  "webhookUrl": "https://APP_ORIGIN/api/ramp/webhook"
}
```

Return an `id`, HTTPS `checkoutUrl`, `embeddable: true`, and integer `grossCents`, `platformFeeCents`, `providerFeeCents`, `netCents`. All amounts must reconcile. Checkout origins must match `RAMP_ALLOWED_ORIGINS`. For off-ramp, the provider must support a user-authorized transfer from the Privy wallet into its payout flow; implement and verify that wallet transfer integration before enabling withdrawals. The app does not autonomously transfer funds to a provider.

`GET /sessions/{id}` is the authoritative receipt. For `status: "completed"`, return the same `merchantReference`, `wallet`, `direction`, `currency`, amounts, and `platformFeeSettled: true`. On-ramp also requires `asset: "SOL"`, positive integer-string `deliveredLamports`, and `settlementReference`; off-ramp requires `payoutReference`. Completion must mean irrevocably confirmed delivery/payout and earned merchant fee, not checkout created, authorization, pending settlement, or user redirect. Rejected or unsettled receipts must never report completed.

Notify the app webhook with a raw JSON body containing `merchantReference`. Set `x-cfk-timestamp` to Unix seconds and `x-cfk-signature` to lower-case hex HMAC-SHA256 of `timestamp + "." + rawBody`, using `RAMP_WEBHOOK_SECRET`. Sign the exact transmitted bytes. The app rejects signatures outside five minutes and retrieves the authoritative receipt itself. Duplicate webhooks are safe. Retry failed notifications with a fresh timestamp/signature.

Provider acceptance tests must cover fee rejection, provider fees, failed/canceled/expired payments, wallet mismatch, incorrect network, partial/delayed settlement, duplicate notifications, closed iframe, reload recovery, user-controlled wallet transfer, cash payout, refunds, and fee reversals. Refund/chargeback reconciliation and reporting adjustments are not implemented and must be added to the selected provider integration before production.
