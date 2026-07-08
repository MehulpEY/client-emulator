// Public architecture documentation. The chrome (header, left nav, right rail)
// lives in DocLayout; this file owns the article: the section data, a small block
// renderer, and the Mermaid diagram islands. Prose lives in the SECTIONS data so
// the numbers stay honest (they arrive from the registry via props) and the
// content is easy to maintain.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DocLayout, type NavGroup } from "@/components/architecture/DocLayout";
import { Mermaid } from "@/components/architecture/Mermaid";

export interface ArchStats {
  adapters: number;
  endpoints: number;
  categories: number;
  fleetDevices: number;
  fleetUsers: number;
  discoveryAdapters: number;
  withParams: number;
  assetTypes: string[];
  normalizers: number;
  tables: number;
}

// -- content model ------------------------------------------------------------

type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "mermaid"; code: string; caption?: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "note"; title?: string; text: string }
  | { t: "table"; head: string[]; rows: string[][] };

interface Section {
  id: string;
  group: string;
  title: string;
  lead?: string;
  blocks: Block[];
}

function buildSections(s: ArchStats): Section[] {
  return [
    // ---------------------------------------------------------------- overview
    {
      id: "overview",
      group: "Overview",
      title: "System overview",
      lead: "One Next.js application that plays two roles at once.",
      blocks: [
        {
          t: "p",
          text:
            "The Client Tool Emulator is a single Next.js 14 application. It emulates the cybersecurity " +
            "tools a client runs, and on top of those mocks it runs an adapter platform that behaves like " +
            "an asset-inventory product such as Axonius. There is no separate backend service: the same " +
            "deployment serves the browser dashboard, the mock vendor APIs, the gateway, and the " +
            "background jobs. State that has to survive a restart lives in a Postgres database hosted on " +
            "Supabase.",
        },
        {
          t: "p",
          text:
            "The point of the product is to let an AI agent, or any integration, exercise a realistic " +
            "security stack end to end without touching a real client environment. An agent can call a " +
            "mock API directly, or it can go through a configured connection. Either way it gets a " +
            "believable, vendor-shaped response, and every call is recorded in a request trace.",
        },
        {
          t: "p",
          text:
            "A request travels through a fixed set of layers. The edge middleware decides whether a route " +
            "is public or needs a session. Route handlers under the API folder do the HTTP work. The " +
            "domain code under the lib folder holds the real logic: the mock engine, the tool registry, " +
            "the adapter machinery, and the correlation store. The database sits at the end of that chain.",
        },
        {
          t: "mermaid",
          caption: "The request path, from any consumer down to the database.",
          code:
`flowchart TD
  A["Browser, AI agent, or webhook consumer"] --> B["Edge middleware<br/>public route? session valid? admin only?"]
  B --> C["API route handlers<br/>/api/mock, /api/gateway,<br/>/api/adapters, /api/auth"]
  C --> D["Domain layer (lib/)<br/>engine, registry, fleet,<br/>adapters, gateway-core,<br/>fetch, normalize, correlate"]
  D --> E[("Supabase Postgres<br/>emulator schema")]`,
        },
        {
          t: "p",
          text:
            `Two ideas make the rest of this document easier to follow. First, the code registry is the ` +
            `source of truth for the catalog: the list of ${s.adapters} tools and their ${s.endpoints} ` +
            `endpoints comes from TypeScript files, not from the database, so the dashboard still renders ` +
            `the catalog when the database is offline. Second, the database holds only runtime state: ` +
            `connections, sessions, fetch history, correlated assets, logs, and keys.`,
        },
      ],
    },

    // ----------------------------------------------------------------- stack
    {
      id: "stack",
      group: "Overview",
      title: "Technology stack",
      blocks: [
        {
          t: "table",
          head: ["Concern", "Choice", "Notes"],
          rows: [
            ["Framework", "Next.js 14 (App Router)", "Server components, route handlers, and edge middleware, all in one app."],
            ["Language", "TypeScript", "Shared types across the API, the domain layer, and the UI."],
            ["UI", "React 18, Tailwind CSS", "A calm enterprise design system with light and dark themes, tuned for WCAG AA contrast."],
            ["Motion and icons", "Framer Motion, Lucide", "Restrained animation, disabled under reduced-motion preferences."],
            ["Diagrams", "Mermaid", "Rendered client-side and themed from the same CSS tokens, so they match light and dark."],
            ["Database", "PostgreSQL on Supabase", "Reached with node-postgres. Everything lives in an emulator schema, never public."],
            ["Email", "Resend", "Transactional email for invites and password resets, over its REST API."],
            ["Hosting", "Vercel, or a long-lived Node server", "The code detects which one it runs on and adapts pooling and scheduling."],
          ],
        },
        {
          t: "p",
          text:
            "There are deliberately few dependencies. The mock responses, the correlation logic, and the " +
            "scheduling are all plain TypeScript. That keeps behaviour predictable and the system easy to " +
            "reason about.",
        },
      ],
    },

    // -------------------------------------------------------------- two layers
    {
      id: "two-layers",
      group: "Overview",
      title: "The two layers",
      lead: "An emulator core, and an adapter platform built on top of it.",
      blocks: [
        { t: "h", text: "Layer one: the emulator core" },
        {
          t: "p",
          text:
            "Every tool is hand-authored to mirror a real vendor API: the same URL paths, the same " +
            "authentication scheme, and the same response field names. Responses are deterministic, which " +
            "means the same input always produces the same output. Inventory endpoints do not invent " +
            "random data. They project a shared, canonical fleet, so the same laptop shows up in " +
            "CrowdStrike, Qualys, Tenable, and Intune with matching serial numbers and MAC addresses.",
        },
        {
          t: "ul",
          items: [
            "A mock engine that matches a request to an endpoint, checks the tool's auth, applies latency and fault scenarios, logs the call, and can emit an event.",
            "A request trace that records every call, direct or through the gateway, with method, path, status, latency, and redacted headers and bodies.",
            "Publish and subscribe webhooks: an agent can subscribe a URL to a tool's events, and deliveries are signed with HMAC and logged.",
            "Generators: background jobs that emit tool events on a schedule so the environment stays alive without anyone opening the dashboard.",
          ],
        },
        { t: "h", text: "Layer two: the adapter platform" },
        {
          t: "p",
          text:
            `The platform turns each mock tool into an adapter you can connect to. You create a ` +
            `credentialed connection, that connection maintains a live status through scheduled ` +
            `heartbeats, scheduled discovery fetches pull inventory through a single gateway endpoint, and ` +
            `the pulled records are normalized and correlated into one unified asset inventory. Of the ` +
            `${s.adapters} adapters, ${s.discoveryAdapters} run discovery fetches; the rest are ` +
            `enrichment-only tools that answer lookups but do not carry inventory.`,
        },
      ],
    },

    // ------------------------------------------------------------- request path
    {
      id: "request-path",
      group: "Request path",
      title: "Request routing and the edge",
      blocks: [
        {
          t: "p",
          text:
            "The edge middleware runs before every non-static request. It is the first line of defense, " +
            "but not the only one: route handlers and layouts check permissions again on the server " +
            "against the database, so bypassing the edge alone cannot grant access. This is defense in " +
            "depth.",
        },
        { t: "h", text: "Public surfaces (no session required)" },
        {
          t: "ul",
          items: [
            "The public landing page and this architecture page.",
            "The auth endpoints under /api/auth for login, setup, invite acceptance, password reset, and logout.",
            "The mock APIs under /api/mock, because agents authenticate with a per-tool API key rather than a browser session.",
            "The gateway under /api/gateway, because the connection itself embodies the credential.",
            "The inbound webhook receiver under /api/consumer, which accepts server-to-server delivery.",
            "The scheduler trigger at /api/cron/tick, which is protected by a shared secret instead of a session.",
          ],
        },
        { t: "h", text: "Protected and admin-only surfaces" },
        {
          t: "p",
          text:
            "Everything else needs a valid signed session cookie. If the session is missing on a page " +
            "route the user is redirected to the login page; on an API route the response is a 401. A " +
            "smaller set of routes, such as key management and user management, additionally requires the " +
            "administrator role. A signed-in user without that role is redirected away from a page, or " +
            "receives a 403 from an API.",
        },
      ],
    },

    // ------------------------------------------------------------------ engine
    {
      id: "engine",
      group: "Request path",
      title: "The mock engine",
      lead: "The one place a tool call is actually resolved.",
      blocks: [
        {
          t: "p",
          text:
            "Every call to a tool, whether it arrives at a mock API route or through the gateway, is " +
            "resolved by the same engine. Sharing this path is what makes gateway traffic " +
            "indistinguishable from direct traffic in the logs. The engine performs the same steps in the " +
            "same order every time.",
        },
        {
          t: "ol",
          items: [
            "Match the method and path against the tool's endpoint templates, filling path parameters such as an id in the URL.",
            "Check authentication using the tool's own scheme: a bearer token, basic auth, an API key header, or an API key query parameter.",
            "Apply any active scenario for that tool: added latency, a forced error rate, or a forced status code.",
            "Build the deterministic response body from the canonical fleet or the tool's seeded data.",
            "Log the call into the request trace with redacted secrets.",
            "If the call was a successful mutation, publish an event to any subscribers, without blocking the response.",
          ],
        },
        {
          t: "note",
          title: "Why determinism matters",
          text:
            "Because responses are seeded rather than random, a test that passed yesterday passes today " +
            "with the same inputs. It also lets inventory line up across tools: the same seed produces the " +
            "same serial number in two different vendor formats, which is the precondition for correlation.",
        },
      ],
    },

    // ------------------------------------------------------------ registry/fleet
    {
      id: "registry-fleet",
      group: "Request path",
      title: "Tool registry and canonical fleet",
      blocks: [
        {
          t: "p",
          text:
            "The tool registry is a set of TypeScript modules that define each vendor: its endpoints, auth " +
            "scheme, and response shapes. Alongside it, a metadata file adds the adapter-grade details " +
            "used by the platform, such as the connection form fields, the list of asset types the adapter " +
            "fetches, the specific fetch steps it runs, the heartbeat probe, and the vendor permissions the " +
            "documentation lists. Together these two files are the catalog. The dashboard reads them at " +
            "request time, so the catalog is always available even without a database.",
        },
        {
          t: "p",
          text:
            `The canonical fleet is one invented organization that every inventory-bearing tool projects ` +
            `into its own schema. It is generated deterministically from a seeded pseudo-random generator, ` +
            `so the same identifier appears every time. The fleet holds ${s.fleetDevices} devices and ` +
            `${s.fleetUsers} users, each with a stable hostname, MAC address, serial number, and email. ` +
            `Because CrowdStrike, Qualys, Meraki, Entra, and the other adapters all draw from this one ` +
            `fleet, cross-adapter correlation on serial, MAC, hostname, and email genuinely works from end ` +
            `to end.`,
        },
        {
          t: "note",
          title: "The key consequence",
          text:
            "Correlation is not pre-computed or faked. Two adapters independently report the same machine " +
            "because they both project the same fleet. When their records meet in the asset store, they " +
            "merge for a real reason: the identifiers actually match.",
        },
      ],
    },

    // ---------------------------------------------------------------- adapters
    {
      id: "adapters",
      group: "Adapters",
      title: "Adapters and connections",
      lead: "A connection is one configured account, backed by a real credential.",
      blocks: [
        { t: "h", text: "Creating a connection provisions a real credential" },
        {
          t: "p",
          text:
            "This is the design decision that makes the platform behave like a real system rather than a " +
            "mock-up. When you create a connection, three things happen. A connection row is written with " +
            "status pending. A random secret is generated and stored on the server side, never returned to " +
            "the browser. And an actual API key row is inserted for that tool, whose secret is exactly that " +
            "stored secret.",
        },
        {
          t: "p",
          text:
            `From then on, when a heartbeat, a fetch, or a gateway call runs, the platform injects that ` +
            `secret using the tool's own auth scheme, and the engine validates it with the same auth check ` +
            `any request hits. So the credential is genuine. Disable the connection, or simulate revoked ` +
            `credentials, and the key is deactivated, at which point the engine returns a real 401 for that ` +
            `connection's traffic. Of the ${s.adapters} adapters, ${s.withParams} define a connection form ` +
            `with credential fields; the validator rejects unknown fields and names any missing required ` +
            `field.`,
        },
        { t: "h", text: "The lifecycle is driven by real probes" },
        {
          t: "p",
          text:
            "Each connection has a heartbeat, a liveness probe that calls the adapter's designated read " +
            "endpoint through the gateway. The outcome moves the connection through a state machine. The " +
            "status you see in the dashboard is therefore a record of probes that actually ran, not a " +
            "scripted animation.",
        },
        {
          t: "mermaid",
          caption: "Connection lifecycle. Every transition is written to the event trail.",
          code:
`stateDiagram-v2
  [*] --> pending
  pending --> connected: first heartbeat ok
  pending --> connecting: config or credential change
  connecting --> connected: heartbeat ok
  connected --> degraded: 1 to 2 transient failures
  degraded --> connected: heartbeat ok
  degraded --> error: 3 or more failures
  connected --> error: hard 401
  connected --> disabled: enabled set to false
  error --> connected: heartbeat ok
  disabled --> connecting: re-enabled`,
        },
        {
          t: "table",
          head: ["State", "Meaning", "How it is reached"],
          rows: [
            ["pending", "Just created, not yet probed.", "Set at creation."],
            ["connecting", "Revalidating after a change.", "Credentials or configuration changed, or the connection was re-enabled."],
            ["connected", "Healthy and authorized.", "A heartbeat got an authorized answer from the vendor mock."],
            ["degraded", "One or two recent transient failures.", "A 5xx or a simulated outage, with a failure streak below three."],
            ["error", "Unhealthy.", "Three or more consecutive transient failures, or a hard 401 on any probe or fetch step."],
            ["disabled", "Turned off by a user.", "The enabled flag was set to false; its credential is deactivated."],
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- sessions
    {
      id: "sessions",
      group: "Adapters",
      title: "Sessions and observable reuse",
      blocks: [
        {
          t: "p",
          text:
            "A real client SDK authenticates once and reuses that session across many calls. The platform " +
            "models this directly. The first call on a connection mints a session with a time to live, " +
            "commonly thirty minutes. Every later call within that window reuses the same session and " +
            "increments a use counter. Changing credentials, disabling the connection, or simulating " +
            "revocation kills the live sessions.",
        },
        {
          t: "p",
          text:
            "Reuse is made visible rather than merely claimed. The connection tracks how many sessions it " +
            "has issued and how many times it has reused one, and the gateway returns a header that states " +
            "whether the current call reused a session. This is a deliberate step beyond the product it " +
            "imitates, which re-authenticates on every fetch and keeps no session alive between cycles.",
        },
      ],
    },

    // ----------------------------------------------------------------- gateway
    {
      id: "gateway",
      group: "Adapters",
      title: "The gateway",
      lead: "One URL per connection, any endpoint on the underlying tool.",
      blocks: [
        {
          t: "p",
          text:
            "The gateway gives each connection a single base URL of the form " +
            "/api/gateway/<connection>/<tool path>. It is the one choke point that the public gateway " +
            "route, the heartbeats, and the fetch steps all pass through, which keeps behaviour " +
            "consistent. For each call it does the following.",
        },
        {
          t: "ol",
          items: [
            "Load the connection and resolve which tool it points at.",
            "Inject the connection's provisioned credential in that tool's real auth scheme.",
            "Apply connection-level fault injection: a simulated outage returns a 502 after a short pause, and a slow simulation adds delay.",
            "Run the real mock engine, so path matching, auth, scenarios, latency, logging, and events all apply.",
            "Record the call in the same request trace used for direct calls.",
          ],
        },
        {
          t: "p",
          text:
            "The gateway is public on purpose. The connection carries the credential, so no browser " +
            "session is needed to call it. That mirrors how an integration in the field would reach a " +
            "vendor: through the credential, not through a human login.",
        },
      ],
    },

    // ------------------------------------------------------------------- fetch
    {
      id: "fetch",
      group: "Assets",
      title: "Discovery fetches",
      blocks: [
        {
          t: "p",
          text:
            "A discovery fetch is a real multi-step run against the adapter. It opens one session for the " +
            "whole run, which is where session reuse becomes visible, then it works through the adapter's " +
            "fetch steps in order. For each step it calls the endpoint through the gateway, reads the " +
            "records array out of the response, normalizes each record, and correlates it into the asset " +
            "store.",
        },
        {
          t: "mermaid",
          caption: "One discovery run. The dashed edge is the history written for every run.",
          code:
`flowchart LR
  S["Open one session"] --> F["Call fetch steps<br/>through the gateway"]
  F --> X["Extract records<br/>via a dotted path"]
  X --> N["Normalize per tool"]
  N --> C["Correlate and upsert"]
  C --> H[("assets and<br/>asset_sources")]
  F -.-> R[("fetch_runs<br/>history")]`,
        },
        {
          t: "p",
          text:
            "Record extraction is tolerant of vendor quirks. It follows a dotted path to the array, and it " +
            "understands common oddities such as a text envelope that prefixes JSON, or an XML-derived " +
            "wrapper that nests the list one level deeper and collapses a single record into an object.",
        },
        {
          t: "p",
          text:
            "When the run finishes it writes a full history row: whether it succeeded, partially " +
            "succeeded, or failed, its duration, the per-step results, the number of records by asset " +
            "type, and whether the session was reused. If any step's credential is rejected, the run " +
            "records an auth failure and moves the connection to error, so the fetch history and the " +
            "connection status always agree.",
        },
        {
          t: "table",
          head: ["Run status", "Meaning"],
          rows: [
            ["success", "Every step completed without error."],
            ["partial", "Some steps succeeded and some failed."],
            ["failed", "Every step failed."],
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ assets
    {
      id: "assets",
      group: "Assets",
      title: "Normalization and correlation",
      lead: "Vendor records in, one explainable asset inventory out.",
      blocks: [
        { t: "h", text: "Normalizing" },
        {
          t: "p",
          text:
            `Each inventory tool has a normalizer that turns a vendor record into a common shape. There ` +
            `are ${s.normalizers} tool-specific normalizers plus a generic fallback, so adapters added ` +
            `later still normalize without new code. A normalized record carries the correlation keys ` +
            `pulled out to the top level: the asset type, a stable external id, a display name, and where ` +
            `present the hostname, MAC, serial, and email, along with a summary and the original raw ` +
            `evidence.`,
        },
        { t: "h", text: "Correlating" },
        {
          t: "p",
          text:
            `The asset store merges records into unified assets using a fixed, ordered set of rules. The ` +
            `first rule that matches wins. Keys are lowercased before comparison so formatting differences ` +
            `do not prevent a match. The asset types currently produced are: ${s.assetTypes.join(", ")}.`,
        },
        {
          t: "mermaid",
          caption: "The same device reported by three tools, merged on different keys.",
          code:
`flowchart LR
  CS["CrowdStrike source"] -- serial --> A(("Device asset"))
  QS["Qualys source"] -- mac --> A
  IN["Intune source"] -- hostname --> A
  A --> INV["Unified inventory<br/>each source keeps the rule that merged it"]`,
        },
        {
          t: "table",
          head: ["Asset type", "Correlation rule, in order"],
          rows: [
            ["device", "serial, then MAC, then hostname"],
            ["user", "email"],
            ["vulnerability", "a unique combination of the CVE or QID and the hostname"],
            ["software, saas_app, alert", "no cross-source rule in this version; one asset per source"],
          ],
        },
        {
          t: "p",
          text:
            "The feature that sets this apart is that every source records which rule merged it, stored " +
            "next to the raw vendor evidence. In the assets view you can open one device and see that it " +
            "was merged from CrowdStrike by serial, from Qualys by MAC, and from Intune by hostname, with " +
            "the original record behind each source. This is the deliberate answer to correlation engines " +
            "that behave like a black box.",
        },
        {
          t: "p",
          text:
            "The merge is conservative. Correlation keys only ever fill an empty field; they never " +
            "overwrite one, so a key cannot flap between values. Summary fields take the most recent " +
            "value. A source's assignment to an asset is sticky once made, and the source count on an " +
            "asset is recomputed from the evidence rows rather than guessed.",
        },
      ],
    },

    // -------------------------------------------------------------- schedulers
    {
      id: "schedulers",
      group: "Operations",
      title: "Schedulers and serverless behaviour",
      blocks: [
        {
          t: "p",
          text:
            "Two things need to happen on a timer: generators emit tool events, and adapter cycles run " +
            "heartbeats and fetches. On a long-lived Node server these run in the process itself, on short " +
            "ticks, started once when the server boots. This keeps the simulation moving without anyone " +
            "opening the dashboard.",
        },
        {
          t: "p",
          text:
            "On serverless hosting there is no always-on process, so the in-process timers are skipped and " +
            "an external cron calls the tick endpoint instead. Whichever path runs, the work is claimed " +
            "atomically: a due item is marked as taken in the same database update that checks it is still " +
            "due, so two overlapping ticks cannot run the same probe or fetch twice.",
        },
        {
          t: "note",
          title: "Graceful under a database outage",
          text:
            "If the database is unreachable, the scheduler simply finds nothing to claim and does nothing, " +
            "the catalog still renders from the code registry, and database-backed panels show empty until " +
            "the connection returns. A short circuit breaker stops the app from hammering a paused database.",
        },
      ],
    },

    // -------------------------------------------------------------- data model
    {
      id: "data-model",
      group: "Operations",
      title: "The data model",
      lead: `All runtime state lives in ${s.tables} tables inside the emulator schema.`,
      blocks: [
        {
          t: "table",
          head: ["Table", "What it holds"],
          rows: [
            ["adapter_connections", "One row per configured connection: status, schedule, counters, and the server-side secret."],
            ["connection_sessions", "Minted and reused sessions, each with a time to live."],
            ["connection_events", "The lifecycle trail: created, heartbeat, status change, fetch started and finished."],
            ["fetch_runs", "Discovery history, one row per run, with per-step detail."],
            ["assets", "The correlated, unified inventory of devices, users, and vulnerabilities."],
            ["asset_sources", "Per-source evidence, plus the correlation rule that merged each source."],
            ["api_keys", "Inbound authentication, including the per-connection provisioned credentials."],
            ["request_logs", "The full request trace for direct and gateway calls."],
            ["subscriptions, event_deliveries", "Webhook subscriptions and their signed, logged deliveries."],
            ["generators, scenarios, resources", "Scheduled event emitters, fault-injection settings, and durable tool state."],
            ["users", "Dashboard accounts and roles."],
            ["tools, endpoints", "A mirror of the catalog for reference; the code registry remains authoritative."],
          ],
        },
      ],
    },

    // --------------------------------------------------------------- real data
    {
      id: "real-data",
      group: "Reference",
      title: "Is the data real?",
      lead: "The data is synthetic, but the mechanics are real. The distinction is the whole point.",
      blocks: [
        {
          t: "p",
          text:
            "The honest answer has two halves, and both matter. The inventory content is invented, and " +
            "the machinery around it is genuine.",
        },
        { t: "h", text: "What is not real" },
        {
          t: "ul",
          items: [
            "The inventory is fabricated. There is no live vendor behind any tool. Every device, user, and vulnerability comes from the one canonical fleet.",
            "Vendor responses are hand-authored mocks, not proxied from a real API. They copy real paths, auth schemes, and field names, but the bytes are emulated.",
            "The failures are opt-in. Revoked credentials, outages, and slow responses happen only when you choose to simulate them.",
          ],
        },
        { t: "h", text: "What is real" },
        {
          t: "ul",
          items: [
            "The credential and auth flow. A provisioned key is genuinely validated by the engine. Revoke it and you get a genuine 401.",
            "The lifecycle. Statuses come from probes that actually ran, with results that actually returned, all persisted and timestamped.",
            "The correlation. Because every tool projects the same fleet, the same machine really does appear in several tools and really does merge on matching identifiers.",
            "Session reuse. Real rows, a real time to live, and counters you can watch increase.",
            "The persistence. Everything lands in a real Postgres database.",
          ],
        },
        {
          t: "note",
          title: "The mental model",
          text:
            "Think of a flight simulator rather than a video of a flight. The weather is synthetic and you " +
            "decide when the engine fails, but the cockpit, the controls, and the way the aircraft responds " +
            "are faithful. You are exercising the real behaviour of an adapter platform against invented " +
            "inventory. That combination is what makes hard scenarios, such as a connection degrading or a " +
            "fetch coming back partial, demonstrable and repeatable in a way a real tenant cannot provide on demand.",
        },
      ],
    },

    // ------------------------------------------------------------ integrations
    {
      id: "integrations",
      group: "Reference",
      title: "External services and integrations",
      blocks: [
        {
          t: "table",
          head: ["Service", "Role", "How it is used"],
          rows: [
            ["Supabase Postgres", "System of record for runtime state", "Reached through a connection pool. On serverless the app upgrades a recognized pooler URL to the transaction pooler so many function instances do not exhaust the connection limit."],
            ["Resend", "Transactional email", "Sends invitations and password reset links over a REST call. If it is not configured, the app falls back to sharing an invite link manually."],
            ["Vercel", "Serverless hosting target", "The app detects serverless mode, keeps a tiny per-instance pool, and lets an external cron drive the schedulers."],
            ["Outbound webhooks", "Event delivery to consumers", "Domain events are delivered to subscriber URLs and signed with HMAC so the receiver can verify them."],
            ["AI agents and integrations", "The primary consumers", "They point a tool integration at a mock API directly, or at a connection's gateway URL."],
          ],
        },
      ],
    },

    // --------------------------------------------------------------- security
    {
      id: "security",
      group: "Reference",
      title: "Authentication and the security model",
      blocks: [
        {
          t: "p",
          text:
            "Dashboard access is invitation-only. The first run creates the administrator account through " +
            "a setup page. After that, new accounts are added by invitation, delivered by email or by " +
            "sharing a link, and an active user can reset their own password through a single-use link " +
            "that expires after one hour.",
        },
        {
          t: "p",
          text:
            "Sessions are carried in a signed cookie. The edge middleware verifies the signature and the " +
            "role, and the server verifies again against the database inside route handlers and layouts. " +
            "Secrets are never returned to the browser: connection credentials are stored server-side and " +
            "are redacted or masked in every API response. Request logs redact sensitive headers and " +
            "bodies before they are stored.",
        },
        {
          t: "p",
          text:
            "The public surfaces are intentional and narrow. The mock APIs and the gateway are reachable " +
            "without a session because they authenticate with a tool key or a connection credential. The " +
            "cron trigger is guarded by a shared secret. Everything else requires a signed-in user, and a " +
            "few sensitive areas require the administrator role.",
        },
      ],
    },
  ];
}

// -- block renderer -----------------------------------------------------------

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p":
      return <p className="mt-4 text-[14.5px] leading-[1.75] text-text2">{b.text}</p>;
    case "h":
      return <h3 className="mt-8 text-[15px] font-bold tracking-[-0.01em]">{b.text}</h3>;
    case "mermaid":
      return <Mermaid code={b.code} caption={b.caption} />;
    case "ul":
      return (
        <ul className="mt-4 space-y-2">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-2.5 text-[14.5px] leading-[1.7] text-text2">
              <span className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full bg-accent" aria-hidden />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="mt-4 space-y-2">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-3 text-[14.5px] leading-[1.7] text-text2">
              <span className="mono mt-0.5 flex-none text-[12px] font-bold text-accent-fg tnum">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{it}</span>
            </li>
          ))}
        </ol>
      );
    case "note":
      return (
        <div className="card mt-5 rounded-lg border-l-2 border-l-accent p-4">
          {b.title ? <div className="text-[13px] font-bold">{b.title}</div> : null}
          <p className="mt-1 text-[13.5px] leading-[1.7] text-text2">{b.text}</p>
        </div>
      );
    case "table":
      return (
        <div className="panel emu-scroll mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-hair">
                {b.head.map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-[12px] font-semibold text-text3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-hair align-top last:border-0">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={
                        "px-3.5 py-2.5 leading-[1.6] " +
                        (ci === 0 ? "whitespace-nowrap font-semibold text-text" : "text-text2")
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

// -- article ------------------------------------------------------------------

export function ArchitectureDoc({ stats }: { stats: ArchStats }) {
  const sections = buildSections(stats);

  // Build the left-nav groups, preserving first-seen order.
  const groups: NavGroup[] = [];
  for (const sec of sections) {
    let g = groups.find((x) => x.label === sec.group);
    if (!g) {
      g = { label: sec.group, items: [] };
      groups.push(g);
    }
    g.items.push({ id: sec.id, title: sec.title });
  }

  const tiles = [
    { value: stats.adapters, label: "Adapters" },
    { value: stats.endpoints, label: "Endpoints" },
    { value: stats.discoveryAdapters, label: "With discovery" },
    { value: stats.fleetDevices + stats.fleetUsers, label: "Fleet assets" },
  ];

  return (
    <DocLayout groups={groups}>
      {/* page header */}
      <div className="mb-2 flex items-center gap-1.5 text-[12px] text-text3">
        <Link href="/" className="transition-colors hover:text-accent-fg">
          Home
        </Link>
        <ChevronRight size={12} />
        <span className="text-text2">Architecture</span>
      </div>
      <h1 className="text-[clamp(26px,4vw,38px)] font-bold leading-[1.12] tracking-[-0.02em]">
        Architecture
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-[1.7] text-text2">
        A detailed walk through how the Client Tool Emulator is built: the request path, the mock
        engine, the adapter platform, the correlation store, and the honest answer to whether the
        data is real. This page is public and needs no sign-in.
      </p>

      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 rounded-lg border border-hair bg-surface px-5 py-4">
        {tiles.map((t) => (
          <div key={t.label}>
            <div className="text-[22px] font-bold leading-none tracking-[-0.02em] tnum">{t.value}</div>
            <div className="mt-1 text-[12px] font-semibold text-text3">{t.label}</div>
          </div>
        ))}
      </div>

      {/* sections */}
      <div className="mt-4">
        {sections.map((sec) => (
          <section key={sec.id} id={sec.id} className="scroll-mt-20 border-t border-hair pt-10 mt-10">
            <h2 className="text-[21px] font-bold tracking-[-0.015em]">{sec.title}</h2>
            {sec.lead ? <p className="mt-2 text-[14px] font-medium text-text2">{sec.lead}</p> : null}
            {sec.blocks.map((b, i) => (
              <BlockView key={i} b={b} />
            ))}
          </section>
        ))}
      </div>

      {/* footer of the article */}
      <div className="mt-12 border-t border-hair pt-8">
        <p className="text-[13px] text-text3">
          The engineering contract for this platform lives in the repository under
          docs/adapter-platform. This page summarizes the shipped system in plain language.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link href="/login" className="btn-primary h-10 px-5 text-[13px]">
            Sign in to use it
          </Link>
          <Link href="/" className="btn-ghost h-10 px-5 text-[13px]">
            Back to home
          </Link>
        </div>
      </div>
    </DocLayout>
  );
}
