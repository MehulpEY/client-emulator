# Subscriptions & Webhooks - Architecture

How the Client Tool Emulator handles pub/sub: what runs where, what is persisted,
and what is best-effort. Written against the actual code (file paths and function
names are real and verifiable).

---

## TL;DR (the three questions)

1. **How are subscriptions handled?**
   A consumer registers a **subscription** (a `tool` + `event_type` filter + a
   `target_url`). When a matching event is published, the emulator signs a JSON
   envelope (HMAC-SHA256) and `POST`s it to that URL, recording every attempt.

2. **What architecture is used?**
   A plain **in-process pub/sub** inside the single Next.js app. Events are
   published by calling one function - `publishEvent()` in
   `lib/engine/events.ts` - which matches subscriptions, fans out HTTP POSTs in
   parallel, and logs the results. There is **no message broker, no queue, no
   worker service, no cron** other than an in-process 1s timer for generators.

3. **Is there a dedicated backend, or is it persisted?**
   There is **no dedicated/separate backend service** - it runs in the same
   Next.js Node runtime as everything else. The subscription registry and the
   full delivery history **are persisted** in Supabase Postgres (`emulator`
   schema), so subscriptions survive restarts. Delivery itself is synchronous
   best-effort (not a durable retry queue).

---

## Where it runs

Everything is one Next.js 14 app (App Router, `runtime = "nodejs"` route
handlers). No microservices.

```
                          Next.js app (single process)
  +---------------------------------------------------------------------+
  |                                                                     |
  |  API routes (app/api/**)              Publisher (lib/engine/events) |
  |  - /api/subscriptions      --------->  publishEvent()               |
  |  - /api/subscriptions/[id]            - persist as state (if mapped)|
  |  - /api/events/publish     --------->  - match active subscriptions |
  |  - /api/mock/[tool]/...     (activity) - sign + POST (fan-out)      |
  |  - /api/consumer/demo  (built-in test consumer)                     |
  |                                                                     |
  |  In-process scheduler (lib/engine/scheduler.ts)                     |
  |  - 1s tick fires "generators" ------->  publishEvent(source:sim)    |
  |  - started by instrumentation.ts on boot; state on globalThis       |
  +----------------------------------|----------------------------------+
                                     |  pg (lib/db.ts, pooled, circuit breaker)
                                     v
                          Supabase Postgres  (emulator schema)
                          - subscriptions       (durable registry)
                          - event_deliveries    (durable attempt log)
                          - resources           (durable tool state)
```

The only long-lived background component is the generator scheduler (a
`setInterval`), and it lives in the same process on `globalThis` so it is shared
across module copies. Delivery is not queued to a worker - it happens inline.

---

## The three event sources

Every event flows through the same `publishEvent()` function. Only the `source`
differs:

| Source        | Trigger                                                             | Awaited?                       | Code |
|---------------|--------------------------------------------------------------------|--------------------------------|------|
| `activity`    | A successful **mutating (non-GET)** call to a mock endpoint         | Fire-and-forget (non-blocking) | `app/api/mock/[tool]/[[...path]]/route.ts` |
| `manual`      | Operator clicks **Emit** / `POST /api/events/publish`              | Awaited (UI shows the result)  | `app/api/events/publish/route.ts` |
| `simulator`   | A **generator** fires on its schedule                              | Awaited inside the tick        | `lib/engine/scheduler.ts` |

"Fire-and-forget" for activity means the agent's mock API call returns
immediately; the webhook fan-out runs on the event loop without blocking the
response:

```ts
// app/api/mock/[tool]/[[...path]]/route.ts
if (outcome.emitEvent) {
  void publishEvent({ toolId, toolSlug, eventType: outcome.emitEvent,
                      data: outcome.body, source: "activity" }).catch(() => {});
}
```

---

## What `publishEvent()` does (the core)

`lib/engine/events.ts`. In order:

1. **DB gate.** If `dbAvailable()` is false (circuit breaker open / no DATABASE_URL),
   it returns an empty result and does nothing. No DB = no pub/sub.
2. **Persist-as-state first.** If the tool's event declares a `persist` mapping,
   the payload is upserted into the `resources` table **regardless of whether any
   subscription matches**. This is what makes a generated/created record show up
   on the tool's normal `GET` endpoints. (Details in the statefulness docs.)
3. **Match active subscriptions.** Reads active subs (5s cache, see below) and
   keeps those where `tool_id` is `NULL` **or** equals the event's tool, **and**
   `event_type` is `*` **or** equals the event type.
4. **Build the envelope** (one per delivery gets its own `id`):
   ```json
   { "id": "evt_...", "type": "<event_type>", "tool": "<tool_id>",
     "source": "activity|manual|simulator", "created_at": "<iso>", "data": { ... } }
   ```
5. **Fan out in parallel** with `Promise.all` - one `deliver()` per matched sub.
6. **Return a summary**: `{ eventType, matched, delivered, failed, deliveries[] }`.

### Subscription cache

Active subscriptions are cached in memory for **5 seconds** (`SUB_TTL`) to avoid a
DB read on every event. The cache is **explicitly invalidated** on any
create/update/delete via `invalidateSubscriptionsCache()`, so changes take effect
immediately rather than waiting out the TTL.

---

## Delivery contract (`deliver()`)

Each delivery is an HTTP `POST` to the subscription's `target_url`:

**Headers**

| Header                  | Value                                            |
|-------------------------|--------------------------------------------------|
| `content-type`          | `application/json`                               |
| `user-agent`            | `ClientEmulator-Webhook/1.0`                     |
| `x-emulator-event`      | the event type                                   |
| `x-emulator-tool`       | the tool slug                                    |
| `x-emulator-delivery`   | `dlv_...` (this attempt's id)                    |
| `x-emulator-signature`  | `sha256=<hex>` = HMAC-SHA256(secret, raw body)   |

**Signing.** The signature is `HMAC-SHA256` over the exact serialized body, keyed
by the subscription's `secret` (`whsec_...`). A real consumer verifies it by
recomputing the HMAC with the same secret. (The emulator's own demo consumer
records the header but does not verify it.)

**Timeout & retry.**
- 5s timeout per attempt (`AbortController`).
- Up to **2 attempts** (i.e. one retry).
- Retries on network error / timeout / `5xx`.
- Does **not** retry `4xx` (treated as a permanent consumer rejection).
- This is a fixed single retry - there is **no exponential backoff and no durable
  redelivery queue**. If both attempts fail, the failure is recorded and that is
  the end of it.

**Recording.** Every delivery - success or failure - is inserted into
`event_deliveries` (via best-effort `tryQuery`, so a logging failure never throws
into the caller): status, `response_status`, truncated `response_body` (2 KB),
`attempts`, `error`, and `delivered_at`.

---

## Persistent vs ephemeral

| Thing                          | Where                                   | Survives restart? |
|--------------------------------|-----------------------------------------|-------------------|
| Subscription registry          | Postgres `emulator.subscriptions`       | **Yes**           |
| Delivery history               | Postgres `emulator.event_deliveries`    | **Yes**           |
| Persisted tool state (`persist`)| Postgres `emulator.resources`          | **Yes**           |
| Active-subscription cache      | In-memory, 5s TTL                       | No                |
| Generator schedule / countdown | In-memory on `globalThis`               | No (reloaded from DB) |
| Demo-consumer inbox            | In-memory ring buffer (max 50)          | No                |

So: the **facts** (who is subscribed, what was delivered) are durable; the
**runtime accelerators** (cache, in-flight timers, the demo inbox) are not.

---

## Data model

```sql
-- emulator.subscriptions  (the registry)
subscription_id  text PK           -- 'sub_...'
tool_id          text              -- NULL = every tool
event_type       text  = '*'       -- '*' = every event
target_url       text              -- consumer webhook (the agent trigger)
secret           text              -- 'whsec_...' HMAC signing secret
description      text
active           boolean = true
created_at       timestamptz

-- emulator.event_deliveries  (one row per attempt)
delivery_id      text PK           -- 'dlv_...'
subscription_id  text
tool_id, tool_slug, event_type, source, target_url
payload          jsonb             -- the full envelope sent
status           text              -- 'pending' | 'delivered' | 'failed'
response_status  integer
response_body    text              -- truncated to 2 KB
attempts         integer
error            text
created_at, delivered_at
```

Both use soft `tool_id` references (no FK), so a subscription can exist before the
catalog is seeded and survives a tool being removed. Full DDL: `db/schema.sql`.

---

## API surface

| Method & path                         | Purpose                                             |
|---------------------------------------|-----------------------------------------------------|
| `GET  /api/subscriptions`             | List subscriptions (optional `?tool=`)             |
| `POST /api/subscriptions`             | Create one -> returns the row incl. signing secret |
| `PATCH /api/subscriptions/{id}`       | Activate / pause (`{ active: boolean }`)           |
| `DELETE /api/subscriptions/{id}`      | Delete                                             |
| `POST /api/events/publish`            | Manually emit `{ tool_id, event_type, payload? }`  |
| `POST /api/consumer/demo`             | Built-in test consumer (records to in-memory inbox)|
| `GET  /api/consumer/demo`             | Read what the demo consumer received               |

On create, `target_url` is validated as a URL and `tool_id` (if given) must exist
in the catalog. When the DB is unreachable, writes return `503` and `GET` returns
`{ reachable: false }`.

---

## Reliability characteristics & limitations

- **Best-effort, not a guaranteed bus.** One retry, no backoff, no dead-letter
  queue, no redelivery after process exit. Appropriate for an emulator whose job
  is to *trigger agents during testing*, not to be a production event backbone.
- **DB-coupled.** Publishing requires the DB (to read subscriptions and log
  deliveries). If the circuit breaker is open, events are silently dropped.
- **Single-instance assumption.** Delivery itself is stateless and would work
  behind multiple instances, but the **generator scheduler** assumes one
  long-lived server (`next start`); running N instances would fire generators N
  times. See the README scheduler note.
- **No inbound verification on the emulator side.** The emulator *signs* outbound
  deliveries; it does not require consumers to authenticate. Consumers should
  verify `x-emulator-signature`.

---

## Key files

| File                                         | Role                                            |
|----------------------------------------------|-------------------------------------------------|
| `lib/engine/events.ts`                       | `publishEvent()`, matching, signing, `deliver()`|
| `app/api/subscriptions/route.ts`             | List / create subscriptions                     |
| `app/api/subscriptions/[id]/route.ts`        | Activate-pause / delete                         |
| `app/api/events/publish/route.ts`            | Manual emit                                     |
| `app/api/mock/[tool]/[[...path]]/route.ts`   | Activity trigger on mutating calls              |
| `app/api/consumer/demo/route.ts`             | Built-in demo consumer                          |
| `lib/engine/scheduler.ts`                    | Generator scheduler (`simulator` source)        |
| `lib/db.ts`                                  | Pooled `pg` access + circuit breaker            |
| `db/schema.sql`                              | `subscriptions` / `event_deliveries` tables     |
