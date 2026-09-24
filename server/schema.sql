CREATE TABLE IF NOT EXISTS cfk_sessions (
 id text PRIMARY KEY, consent boolean NOT NULL DEFAULT false, attribution jsonb NOT NULL DEFAULT '{}',
 source_url text NOT NULL, ip text, user_agent text, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days'
);
CREATE TABLE IF NOT EXISTS cfk_orders (
 id uuid PRIMARY KEY, user_id text NOT NULL, wallet text NOT NULL, side text NOT NULL CHECK(side IN ('buy','sell')),
 session_id text REFERENCES cfk_sessions(id), amount_usd_cents bigint NOT NULL CHECK(amount_usd_cents>0),
 input_atomic numeric(30,0) NOT NULL, expected_token_atomic numeric(30,0) NOT NULL, quote jsonb NOT NULL,
 message_hash text NOT NULL, signature text UNIQUE, status text NOT NULL DEFAULT 'prepared',
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
CREATE INDEX IF NOT EXISTS cfk_orders_pending ON cfk_orders(status) WHERE signature IS NOT NULL;
CREATE TABLE IF NOT EXISTS cfk_trades (
 id uuid PRIMARY KEY REFERENCES cfk_orders(id), wallet text NOT NULL, signature text NOT NULL UNIQUE,
 side text NOT NULL, token_atomic numeric(30,0) NOT NULL, sol_lamports numeric(30,0) NOT NULL,
 cost_cents bigint NOT NULL, fee_revenue_cents bigint NOT NULL DEFAULT 0, confirmed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS cfk_trades_wallet ON cfk_trades(wallet,confirmed_at);
CREATE TABLE IF NOT EXISTS cfk_ramps (
 id uuid PRIMARY KEY, provider_id text UNIQUE, user_id text NOT NULL, wallet text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('onramp','offramp')), session_id text REFERENCES cfk_sessions(id), checkout_id text NOT NULL,
 gross_cents bigint NOT NULL, platform_fee_cents bigint NOT NULL, provider_fee_cents bigint NOT NULL DEFAULT 0,
 net_cents bigint NOT NULL, status text NOT NULL DEFAULT 'created', quote jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS cfk_fee_lots (
 id uuid PRIMARY KEY REFERENCES cfk_ramps(id), wallet text NOT NULL, remaining_units numeric(30,0) NOT NULL CHECK(remaining_units>=0),
 original_units numeric(30,0) NOT NULL CHECK(original_units>0), remaining_fee_cents bigint NOT NULL CHECK(remaining_fee_cents>=0),
 original_fee_cents bigint NOT NULL CHECK(original_fee_cents>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cfk_events (
 id text PRIMARY KEY, session_id text REFERENCES cfk_sessions(id), name text NOT NULL,
 value_cents bigint NOT NULL DEFAULT 0 CHECK(value_cents>=0), metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cfk_deliveries (
 event_id text NOT NULL REFERENCES cfk_events(id), provider text NOT NULL, status text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text, delivered_at timestamptz,
 PRIMARY KEY(event_id,provider)
);
CREATE TABLE IF NOT EXISTS cfk_rate_limits (
 bucket text PRIMARY KEY, count integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL
);
ALTER TABLE cfk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfk_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfk_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfk_ramps ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfk_fee_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfk_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfk_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfk_orders ADD COLUMN IF NOT EXISTS funding_id uuid REFERENCES cfk_ramps(id);
CREATE UNIQUE INDEX IF NOT EXISTS cfk_orders_funding ON cfk_orders(funding_id) WHERE funding_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS cfk_market_samples (
 mint text NOT NULL, observed_at timestamptz NOT NULL, price_usd double precision NOT NULL CHECK(price_usd>0),
 PRIMARY KEY(mint,observed_at)
);
ALTER TABLE cfk_market_samples ENABLE ROW LEVEL SECURITY;
