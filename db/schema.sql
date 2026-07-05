-- ============================================================================
-- Client Tool Emulator — database schema
-- Target: Postgres 15+ (Supabase). Idempotent: safe to re-run.
-- Apply:  node scripts/apply-schema.mjs   (no psql required)
--
-- Everything lives in the `emulator` schema — never in `public`. The catalog
-- (tools, endpoints) is seeded deterministically; request_logs records runtime
-- traffic and uses random uuids.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS emulator;
SET search_path TO emulator;

-- gen_random_uuid() is built into Postgres 13+ (pgcrypto is preinstalled on Supabase).

-- ============================================================================
-- tools — the catalog of client cybersecurity tools we stand in for
-- ============================================================================
CREATE TABLE IF NOT EXISTS tools (
    tool_id          text PRIMARY KEY,                 -- slug, e.g. 'virustotal'
    name             text NOT NULL,
    vendor           text,
    category         text NOT NULL,                    -- see lib/tools/categories
    summary          text NOT NULL,
    tags             text[] NOT NULL DEFAULT '{}',
    ai_tool          boolean NOT NULL DEFAULT false,   -- exposes an AI-tool surface (n8n "AI tool")
    crafted          boolean NOT NULL DEFAULT false,   -- true = hand-authored flagship fidelity
    base_path        text NOT NULL,                    -- '/api/mock/<tool_id>'
    auth_type        text NOT NULL DEFAULT 'api_key_header'
                       CHECK (auth_type IN ('api_key_header','api_key_query','bearer','basic','none')),
    auth_param       text,                             -- header/query key name, e.g. 'x-apikey'
    docs_url         text,
    default_latency_ms integer NOT NULL DEFAULT 0,     -- baseline simulated latency
    failure_rate     numeric NOT NULL DEFAULT 0,       -- 0..1 baseline random 5xx rate
    enabled          boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- endpoints — the routes each tool exposes (what an agent can call)
-- ============================================================================
CREATE TABLE IF NOT EXISTS endpoints (
    endpoint_id      text PRIMARY KEY,                 -- deterministic: tool + method + path
    tool_id          text NOT NULL REFERENCES tools(tool_id) ON DELETE CASCADE,
    method           text NOT NULL
                       CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
    path             text NOT NULL,                    -- relative to base, e.g. '/files/{id}'
    operation        text,                             -- short id, e.g. 'getFileReport'
    summary          text NOT NULL,
    ai_tool          boolean NOT NULL DEFAULT false,
    request_example  jsonb NOT NULL DEFAULT '{}'::jsonb,
    response_example jsonb NOT NULL DEFAULT '{}'::jsonb,
    sort             integer NOT NULL DEFAULT 0,
    UNIQUE (tool_id, method, path)
);
CREATE INDEX IF NOT EXISTS endpoints_tool_idx ON endpoints (tool_id);

-- ============================================================================
-- api_keys — secrets agents present to reach the mock endpoints
-- A row with tool_id = NULL is a master key that works for every tool.
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_keys (
    key_id           text PRIMARY KEY,
    tool_id          text REFERENCES tools(tool_id) ON DELETE CASCADE,
    secret           text NOT NULL UNIQUE,
    label            text NOT NULL DEFAULT 'default',
    active           boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_tool_idx ON api_keys (tool_id);

-- ============================================================================
-- scenarios — named behaviour overrides for fault-injection / chaos testing
-- config: { latency_ms, failure_rate, force_status, force_body }
-- ============================================================================
CREATE TABLE IF NOT EXISTS scenarios (
    scenario_id      text PRIMARY KEY,
    tool_id          text REFERENCES tools(tool_id) ON DELETE CASCADE,  -- NULL = applies globally
    name             text NOT NULL,
    description      text,
    config           jsonb NOT NULL DEFAULT '{}'::jsonb,
    active           boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenarios_tool_idx ON scenarios (tool_id);

-- ============================================================================
-- request_logs — every call an agent makes to the emulator (the trace)
-- ============================================================================
CREATE TABLE IF NOT EXISTS request_logs (
    log_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_id          text,                             -- soft ref; kept even if tool removed
    tool_slug        text,                             -- raw slug from the URL (even if unknown)
    endpoint_id      text,
    operation        text,
    method           text NOT NULL,
    path             text NOT NULL,
    query            jsonb NOT NULL DEFAULT '{}'::jsonb,
    request_headers  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- redacted (secrets masked)
    request_body     jsonb,
    status           integer NOT NULL,
    response_body    jsonb,
    latency_ms       integer NOT NULL DEFAULT 0,
    matched          boolean NOT NULL DEFAULT false,      -- hit a known endpoint?
    authorized       boolean NOT NULL DEFAULT false,
    scenario         text,                                -- scenario name applied, if any
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_logs_created_idx ON request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_tool_idx ON request_logs (tool_id, created_at DESC);

-- ============================================================================
-- subscriptions — pub/sub: deliver a tool's events to a consumer's agent URL.
-- tool_id NULL = every tool; event_type '*' = every event. Soft tool ref so a
-- subscription can be created before the catalog is seeded.
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id  text PRIMARY KEY,
    tool_id          text,                              -- NULL = all tools
    event_type       text NOT NULL DEFAULT '*',         -- '*' = all events
    target_url       text NOT NULL,                     -- consumer webhook (agent trigger)
    secret           text NOT NULL,                     -- HMAC-SHA256 signing secret
    description      text,
    active           boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_tool_idx ON subscriptions (tool_id);

-- ============================================================================
-- event_deliveries — every dispatch attempt of an event to a subscription
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_deliveries (
    delivery_id      text PRIMARY KEY,
    subscription_id  text,
    tool_id          text,
    tool_slug        text,
    event_type       text NOT NULL,
    source           text,                              -- 'manual' | 'activity' | 'simulator'
    target_url       text NOT NULL,
    payload          jsonb,
    status           text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','delivered','failed')),
    response_status  integer,
    response_body    text,
    attempts         integer NOT NULL DEFAULT 0,
    error            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    delivered_at     timestamptz
);
CREATE INDEX IF NOT EXISTS event_deliveries_created_idx ON event_deliveries (created_at DESC);
CREATE INDEX IF NOT EXISTS event_deliveries_sub_idx ON event_deliveries (subscription_id, created_at DESC);

-- ============================================================================
-- generators — scheduled "simulators" that auto-emit a tool's events at fixed
-- or random intervals (e.g. random Forcepoint DLP incidents). Configured here,
-- not hardcoded in any tool. Driven by the in-process scheduler.
-- ============================================================================
CREATE TABLE IF NOT EXISTS generators (
    generator_id     text PRIMARY KEY,
    tool_id          text NOT NULL,                     -- soft ref
    event_type       text NOT NULL,
    mode             text NOT NULL DEFAULT 'fixed'
                       CHECK (mode IN ('fixed','random')),
    interval_ms      integer,                           -- fixed mode
    min_ms           integer,                           -- random mode (inclusive)
    max_ms           integer,                           -- random mode (inclusive)
    payload_override jsonb,                             -- optional fixed payload
    active           boolean NOT NULL DEFAULT true,
    run_count        integer NOT NULL DEFAULT 0,
    last_run_at      timestamptz,
    next_run_at      timestamptz,
    description      text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generators_active_idx ON generators (active);

-- ============================================================================
-- resources — durable per-tool state. Events created by a generator, a manual
-- emit, or an agent's mutating call are persisted here, so the tool's normal
-- GET endpoints return the same records (e.g. Forcepoint DLP incidents). A
-- "collection" is a named bucket within a tool, e.g. forcepoint-dlp/incidents.
-- ============================================================================
CREATE TABLE IF NOT EXISTS resources (
    id           bigserial PRIMARY KEY,
    tool_id      text NOT NULL,                     -- soft ref
    collection   text NOT NULL,                     -- e.g. 'incidents'
    resource_id  text NOT NULL,                     -- e.g. 'INC-349605'
    data         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tool_id, collection, resource_id)
);
CREATE INDEX IF NOT EXISTS resources_lookup_idx ON resources (tool_id, collection, created_at DESC);

-- ============================================================================
-- users — dashboard accounts (auth + RBAC). Two roles: administrator (full
-- control: API keys, DB seed, user onboarding, everything) and consumer
-- (observe the emulator + configure pub/sub). Passwords are scrypt-hashed.
-- An invited user has no password until they accept their emailed invite; the
-- invite token is stored only as a sha256 hash. Email is unique (case-insensitive).
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    user_id           text PRIMARY KEY,                 -- 'usr_...'
    email             text NOT NULL,
    name              text NOT NULL DEFAULT '',
    role              text NOT NULL DEFAULT 'consumer'
                        CHECK (role IN ('administrator','consumer')),
    password_hash     text,                             -- scrypt hash; NULL until onboarded
    status            text NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited','active','disabled')),
    invite_token_hash text,                             -- sha256 of the emailed invite token
    invite_expires_at timestamptz,
    created_by        text,                             -- user_id of the admin who invited
    created_at        timestamptz NOT NULL DEFAULT now(),
    onboarded_at      timestamptz,
    last_login_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (lower(email));

-- Self-service password reset: the emailed token is stored only as a sha256
-- hash, single-use, short-lived (1 hour). Additive + idempotent for existing DBs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at timestamptz;

-- ============================================================================
-- ADAPTER PLATFORM (docs/adapter-platform/PLAN.md §4) ------------------------
-- ============================================================================

-- adapter_connections — a credentialed, monitored connection to one tool.
-- params includes the server-only "__secret" (the provisioned api_keys secret,
-- PLAN §4.2); the API layer strips it and redacts password-typed params.
CREATE TABLE IF NOT EXISTS adapter_connections (
    connection_id    text PRIMARY KEY,                  -- 'con_...'
    tool_id          text NOT NULL,                     -- soft ref -> code registry
    label            text NOT NULL DEFAULT 'default',
    notes            text,                              -- Axonius-style memo (<= 250 chars, UI-enforced)
    params           jsonb NOT NULL DEFAULT '{}'::jsonb,
    status           text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','connecting','connected','degraded','error','disabled')),
    status_reason    text,
    enabled          boolean NOT NULL DEFAULT true,
    -- discovery / fetch scheduling (serverless-safe: claimed via next_fetch_at)
    fetch_enabled    boolean NOT NULL DEFAULT true,
    fetch_interval_ms integer NOT NULL DEFAULT 900000,  -- 15 min discovery cycle
    next_fetch_at    timestamptz,
    last_fetch_at    timestamptz,
    -- heartbeat (liveness probe; claimed via next_heartbeat_at)
    heartbeat_interval_ms integer NOT NULL DEFAULT 60000,
    next_heartbeat_at timestamptz,
    last_heartbeat_at timestamptz,
    consecutive_failures integer NOT NULL DEFAULT 0,
    -- connection-level fault injection ("what if the vendor breaks?")
    simulate         text NOT NULL DEFAULT 'none'
                       CHECK (simulate IN ('none','revoked_credentials','unreachable','slow')),
    -- lifetime metrics
    total_fetches    integer NOT NULL DEFAULT 0,
    total_records    integer NOT NULL DEFAULT 0,
    sessions_issued  integer NOT NULL DEFAULT 0,
    session_reuses   integer NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS adapter_connections_tool_idx ON adapter_connections (tool_id);
CREATE INDEX IF NOT EXISTS adapter_connections_due_fetch_idx ON adapter_connections (fetch_enabled, next_fetch_at);
CREATE INDEX IF NOT EXISTS adapter_connections_due_hb_idx ON adapter_connections (enabled, next_heartbeat_at);

-- connection_sessions — the mock "live session" a connection reuses (PLAN §1 claim 3)
CREATE TABLE IF NOT EXISTS connection_sessions (
    session_id       text PRIMARY KEY,                  -- 'ses_...'
    connection_id    text NOT NULL REFERENCES adapter_connections(connection_id) ON DELETE CASCADE,
    token            text NOT NULL,                     -- mock artifact, never the credential
    issued_at        timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    last_used_at     timestamptz NOT NULL DEFAULT now(),
    use_count        integer NOT NULL DEFAULT 0,
    revoked          boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS connection_sessions_conn_idx ON connection_sessions (connection_id, issued_at DESC);

-- connection_events — the lifecycle audit trail (status transitions, tests, sessions)
CREATE TABLE IF NOT EXISTS connection_events (
    event_id         bigserial PRIMARY KEY,
    connection_id    text NOT NULL,
    tool_id          text NOT NULL,
    kind             text NOT NULL
                       CHECK (kind IN ('created','updated','test','heartbeat','status_change',
                                       'session_issued','session_reused','session_expired',
                                       'fetch_started','fetch_finished','simulate_changed','deleted')),
    from_status      text,
    to_status        text,
    detail           text,
    data             jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connection_events_conn_idx ON connection_events (connection_id, created_at DESC);

-- fetch_runs — one discovery execution of a connection (the "fetch history")
CREATE TABLE IF NOT EXISTS fetch_runs (
    run_id           text PRIMARY KEY,                  -- 'run_...'
    connection_id    text NOT NULL,
    tool_id          text NOT NULL,
    trigger          text NOT NULL DEFAULT 'schedule'
                       CHECK (trigger IN ('schedule','manual','test')),
    status           text NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running','success','partial','failed')),
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    duration_ms      integer,
    requests_made    integer NOT NULL DEFAULT 0,
    session_reused   boolean NOT NULL DEFAULT false,
    records_by_type  jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"device": 42, "user": 17}
    total_records    integer NOT NULL DEFAULT 0,
    error            text,
    steps            jsonb NOT NULL DEFAULT '[]'::jsonb  -- FetchRunStep[] (lib/adapters/types.ts)
);
CREATE INDEX IF NOT EXISTS fetch_runs_conn_idx ON fetch_runs (connection_id, started_at DESC);
CREATE INDEX IF NOT EXISTS fetch_runs_started_idx ON fetch_runs (started_at DESC);

-- assets — the normalized, correlated inventory
CREATE TABLE IF NOT EXISTS assets (
    asset_id         text PRIMARY KEY,                  -- 'ast_...'
    asset_type       text NOT NULL
                       CHECK (asset_type IN ('device','user','vulnerability','software','saas_app','alert')),
    display_name     text NOT NULL,
    -- correlation keys (nullable; lowercased at write time; PLAN §4.5)
    hostname         text,
    mac              text,
    serial           text,
    email            text,
    external_keys    jsonb NOT NULL DEFAULT '{}'::jsonb,
    summary          jsonb NOT NULL DEFAULT '{}'::jsonb, -- merged normalized fields for list views
    first_seen       timestamptz NOT NULL DEFAULT now(),
    last_seen        timestamptz NOT NULL DEFAULT now(),
    source_count     integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS assets_type_idx ON assets (asset_type, last_seen DESC);
CREATE INDEX IF NOT EXISTS assets_hostname_idx ON assets (asset_type, hostname);
CREATE INDEX IF NOT EXISTS assets_mac_idx ON assets (asset_type, mac);
CREATE INDEX IF NOT EXISTS assets_serial_idx ON assets (asset_type, serial);
CREATE INDEX IF NOT EXISTS assets_email_idx ON assets (asset_type, email);

-- asset_sources — per-adapter evidence attached to a correlated asset
CREATE TABLE IF NOT EXISTS asset_sources (
    id               bigserial PRIMARY KEY,
    asset_id         text NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    asset_type       text NOT NULL,
    tool_id          text NOT NULL,
    connection_id    text NOT NULL,
    external_id      text NOT NULL,                     -- the id in the vendor's system
    correlation_rule text,                              -- 'serial'|'mac'|'hostname'|'email'|'new'
    normalized       jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw              jsonb NOT NULL DEFAULT '{}'::jsonb,
    fetch_run_id     text,
    first_seen       timestamptz NOT NULL DEFAULT now(),
    last_seen        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tool_id, connection_id, asset_type, external_id)
);
CREATE INDEX IF NOT EXISTS asset_sources_asset_idx ON asset_sources (asset_id);
CREATE INDEX IF NOT EXISTS asset_sources_conn_idx ON asset_sources (connection_id, last_seen DESC);
