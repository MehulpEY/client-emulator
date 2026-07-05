#!/usr/bin/env node
// ============================================================================
// Adapter platform — end-to-end acceptance script (PLAN §4, VERIFICATION.md).
// Run against a live app + DB:
//   EMU_ADMIN_EMAIL=... EMU_ADMIN_PASSWORD=... node scripts/verify-adapters.mjs
// Optional: EMU_BASE (default http://localhost:3002), KEEP=1 to skip cleanup.
//
// Exercises the whole loop: catalog → create connection (provisions a real
// api_key) → dry-run test → full test (heartbeat) → gateway call ×2 (session
// reuse) → manual fetch → fetch history → correlated assets across TWO
// adapters → simulated credential revocation → recovery → cleanup.
// ============================================================================

const BASE = process.env.EMU_BASE || "http://localhost:3002";
const EMAIL = process.env.EMU_ADMIN_EMAIL;
const PASSWORD = process.env.EMU_ADMIN_PASSWORD;
const KEEP = process.env.KEEP === "1";

let cookie = "";
const results = [];
const created = []; // connection ids for cleanup

function log(line) { process.stdout.write(line + "\n"); }

async function req(method, path, body, extra = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(extra.headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json, headers: r.headers };
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail: detail || "" });
    log(`  PASS  ${name}${detail ? `  — ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: String(err.message || err) });
    log(`  FAIL  ${name}  — ${String(err.message || err)}`);
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollFetchDone(connectionId, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { json } = await req("GET", `/api/fetches?connection=${connectionId}&limit=1`);
    const run = json?.runs?.[0];
    if (run && run.status !== "running") return run;
    await sleep(1500);
  }
  throw new Error(`fetch did not finish within ${timeoutMs / 1000}s`);
}

async function main() {
  log(`\nAdapter platform verification against ${BASE}\n`);

  await step("health", async () => {
    const { status, json } = await req("GET", "/api/health");
    assert(status === 200 && json?.ok !== false, `health ${status}`);
    assert(json?.db?.reachable, "DB not reachable — apply schema + set DATABASE_URL first");
    return `db ok, catalog ${json?.catalog?.tools ?? "?"} tools`;
  });

  await step("login (admin)", async () => {
    assert(EMAIL && PASSWORD, "set EMU_ADMIN_EMAIL / EMU_ADMIN_PASSWORD");
    const r = await fetch(BASE + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    assert(r.ok, `login ${r.status}`);
    const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")].filter(Boolean);
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    assert(cookie.includes("emu_session"), "no session cookie returned");
  });

  await step("adapters catalog lists >= 15 with meta", async () => {
    const { status, json } = await req("GET", "/api/adapters");
    assert(status === 200, `GET /api/adapters -> ${status}`);
    assert(Array.isArray(json?.adapters) && json.adapters.length >= 15, `got ${json?.adapters?.length} adapters`);
    const cs = json.adapters.find((a) => a.toolId === "crowdstrike");
    assert(cs && Array.isArray(cs.assetTypes) && cs.assetTypes.includes("device"), "crowdstrike meta missing assetTypes");
    return `${json.adapters.length} adapters`;
  });

  let csConn, qlConn;

  await step("dry-run connectivity test (no persist)", async () => {
    const { status, json } = await req("POST", "/api/adapters/crowdstrike/connections/test", {
      params: { domain: "api.crowdstrike.com", client_id: "verify", client_secret: "s3cret-verify" },
    });
    assert(status === 200 && json?.ok, `dry-run -> ${status} ${JSON.stringify(json)}`);
  });

  await step("create CrowdStrike connection", async () => {
    const { status, json } = await req("POST", "/api/adapters/crowdstrike/connections", {
      label: "verify-cs", params: { domain: "api.crowdstrike.com", client_id: "verify", client_secret: "s3cret-verify" },
    });
    assert(status === 200 && json?.ok && json?.connection?.connectionId, `create -> ${status} ${JSON.stringify(json)}`);
    csConn = json.connection.connectionId;
    created.push(csConn);
    assert(json.connection.params?.client_secret === "•••" || json.connection.params?.client_secret === undefined, "secret not redacted in response");
    assert(!("__secret" in (json.connection.params || {})), "__secret leaked in API response");
    return csConn;
  });

  await step("test connection -> connected", async () => {
    const { status, json } = await req("POST", `/api/adapters/connections/${csConn}/test`);
    assert(status === 200 && json?.ok, `test -> ${status} ${JSON.stringify(json)}`);
    assert(json.status === "connected", `expected connected, got ${json.status} (${json.statusReason || "no reason"})`);
  });

  await step("gateway descriptor + session mint/reuse", async () => {
    const d1 = await req("GET", `/api/gateway/${csConn}`);
    assert(d1.status === 200 && d1.json?.ok, `descriptor -> ${d1.status}`);
    const c1 = await req("GET", `/api/gateway/${csConn}/devices/entities/devices/v2`);
    assert(c1.status === 200, `gateway call 1 -> ${c1.status}`);
    const c2 = await req("GET", `/api/gateway/${csConn}/devices/entities/devices/v2`);
    assert(c2.status === 200, `gateway call 2 -> ${c2.status}`);
    assert(c2.headers.get("x-emu-session-reused") === "true", "second gateway call did not reuse the session");
    const resources = c2.json?.resources;
    assert(Array.isArray(resources) && resources.length > 0, "gateway device payload empty — fleet projection missing?");
    return `${resources.length} devices via gateway`;
  });

  await step("manual fetch (CrowdStrike) succeeds with records", async () => {
    const { status, json } = await req("POST", `/api/adapters/connections/${csConn}/fetch`);
    assert(status === 200 && json?.ok, `fetch -> ${status} ${JSON.stringify(json)}`);
    const run = await pollFetchDone(csConn);
    assert(run.status === "success", `run status ${run.status} (${run.error || "no error"})`);
    assert(run.totalRecords > 0, "fetch returned zero records");
    return `${run.totalRecords} records in ${run.durationMs}ms, sessionReused=${run.sessionReused}`;
  });

  await step("create + fetch Qualys connection", async () => {
    const { status, json } = await req("POST", "/api/adapters/qualys/connections", {
      label: "verify-ql", params: { domain: "qualysapi.qualys.com", username: "verify", password: "s3cret-verify" },
    });
    assert(status === 200 && json?.ok, `create -> ${status}`);
    qlConn = json.connection.connectionId;
    created.push(qlConn);
    const t = await req("POST", `/api/adapters/connections/${qlConn}/test`);
    assert(t.json?.status === "connected", `qualys test -> ${t.json?.status}`);
    const f = await req("POST", `/api/adapters/connections/${qlConn}/fetch`);
    assert(f.status === 200 && f.json?.ok, `fetch -> ${f.status}`);
    const run = await pollFetchDone(qlConn);
    assert(run.status === "success" && run.totalRecords > 0, `qualys run ${run.status}, ${run.totalRecords} records`);
    return `${run.totalRecords} records`;
  });

  await step("assets correlated across BOTH adapters", async () => {
    const { status, json } = await req("GET", "/api/assets?type=device&limit=200");
    assert(status === 200, `assets -> ${status}`);
    assert(json.total > 0, "no device assets");
    const multi = json.assets.filter((a) => a.sourceCount >= 2);
    assert(multi.length > 0, "no asset has 2+ sources — correlation not working");
    const detail = await req("GET", `/api/assets/${multi[0].assetId}`);
    const tools = new Set((detail.json?.asset?.sources || []).map((s) => s.toolId));
    assert(tools.has("crowdstrike") && tools.has("qualys"), `sources are ${[...tools].join(",")}`);
    const rules = (detail.json?.asset?.sources || []).map((s) => s.correlationRule).filter(Boolean);
    assert(rules.length > 0, "no correlationRule recorded on sources");
    return `${multi.length} correlated devices; example rules: ${rules.join("/")}`;
  });

  await step("simulate credential revocation -> error -> recovery", async () => {
    const rev = await req("PATCH", `/api/adapters/connections/${csConn}`, { simulate: "revoked_credentials" });
    assert(rev.json?.ok, `patch simulate -> ${rev.status}`);
    const t1 = await req("POST", `/api/adapters/connections/${csConn}/test`);
    assert(t1.json?.status === "error", `expected error after revocation, got ${t1.json?.status}`);
    const back = await req("PATCH", `/api/adapters/connections/${csConn}`, { simulate: "none" });
    assert(back.json?.ok, "patch simulate none failed");
    const t2 = await req("POST", `/api/adapters/connections/${csConn}/test`);
    assert(t2.json?.status === "connected", `expected recovery to connected, got ${t2.json?.status}`);
  });

  await step("lifecycle events recorded", async () => {
    const { status, json } = await req("GET", `/api/adapters/connections/${csConn}/events?limit=100`);
    assert(status === 200 && Array.isArray(json?.events), `events -> ${status}`);
    const kinds = new Set(json.events.map((e) => e.kind));
    for (const k of ["created", "status_change", "session_issued", "fetch_finished"]) {
      assert(kinds.has(k), `missing lifecycle event kind "${k}" (have: ${[...kinds].join(",")})`);
    }
    return `${json.events.length} events, kinds: ${[...kinds].join(",")}`;
  });

  if (!KEEP) {
    await step("cleanup (delete verify connections)", async () => {
      for (const id of created) {
        const { status } = await req("DELETE", `/api/adapters/connections/${id}`);
        assert(status === 200, `delete ${id} -> ${status}`);
      }
      return `${created.length} deleted`;
    });
  }

  const failed = results.filter((r) => !r.ok);
  log(`\n${"=".repeat(60)}`);
  log(`RESULT: ${results.length - failed.length}/${results.length} steps passed${failed.length ? " — FAILURES:" : ""}`);
  for (const f of failed) log(`  ✗ ${f.name}: ${f.detail}`);
  log("");
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { log(`fatal: ${err.stack || err}`); process.exit(1); });
