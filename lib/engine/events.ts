import { createHmac, randomBytes } from "node:crypto";
import { tryQuery, dbAvailable, SCHEMA } from "../db";
import { getTool } from "../tools/registry";
import { putResource } from "./store";

// Pub/sub delivery. publishEvent() fans an event out to every active
// subscription whose (tool, event_type) matches, signs the body (HMAC-SHA256
// with the subscription secret), POSTs it to the consumer's URL with a short
// timeout + one retry, and records each attempt in event_deliveries.

interface SubscriptionRow {
  subscription_id: string;
  tool_id: string | null;
  event_type: string;
  target_url: string;
  secret: string;
  active: boolean;
}

let subCache: { at: number; rows: SubscriptionRow[] } | null = null;
const SUB_TTL = 5000;

export function invalidateSubscriptionsCache() { subCache = null; }

async function activeSubscriptions(): Promise<SubscriptionRow[]> {
  if (subCache && Date.now() - subCache.at < SUB_TTL) return subCache.rows;
  const rows = await tryQuery<SubscriptionRow>(
    `select subscription_id, tool_id, event_type, target_url, secret, active from ${SCHEMA}.subscriptions where active = true`
  );
  subCache = { at: Date.now(), rows };
  return rows;
}

function matches(sub: SubscriptionRow, toolId: string, eventType: string): boolean {
  const toolOk = sub.tool_id === null || sub.tool_id === toolId;
  const typeOk = sub.event_type === "*" || sub.event_type === eventType;
  return toolOk && typeOk;
}

export interface PublishInput {
  toolId: string;
  toolSlug: string;
  eventType: string;
  data: any;
  source: "manual" | "activity" | "simulator";
}

export interface DeliveryResult {
  delivery_id: string;
  subscription_id: string;
  target_url: string;
  status: "delivered" | "failed";
  response_status: number | null;
  attempts: number;
  error: string | null;
}

export interface PublishResult {
  eventType: string;
  matched: number;
  delivered: number;
  failed: number;
  deliveries: DeliveryResult[];
}

const DELIVERY_TIMEOUT = 5000;

async function deliver(sub: SubscriptionRow, envelope: any, source: string, toolSlug: string): Promise<DeliveryResult> {
  const deliveryId = `dlv_${randomBytes(10).toString("hex")}`;
  const body = JSON.stringify(envelope);
  const signature = "sha256=" + createHmac("sha256", sub.secret).update(body).digest("hex");

  let attempts = 0;
  let status: "delivered" | "failed" = "failed";
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;

  while (attempts < 2 && status !== "delivered") {
    attempts++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT);
    try {
      const res = await fetch(sub.target_url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "ClientEmulator-Webhook/1.0",
          "x-emulator-event": envelope.type,
          "x-emulator-tool": toolSlug,
          "x-emulator-delivery": deliveryId,
          "x-emulator-signature": signature,
        },
        body,
        signal: controller.signal,
      });
      responseStatus = res.status;
      responseBody = (await res.text().catch(() => "")).slice(0, 2000);
      if (res.ok) { status = "delivered"; error = null; }
      else { error = `HTTP ${res.status}`; if (res.status < 500) break; } // don't retry 4xx
    } catch (e: any) {
      error = e?.name === "AbortError" ? "timeout" : (e?.message || "delivery failed");
    } finally {
      clearTimeout(timer);
    }
  }

  await tryQuery(
    `insert into ${SCHEMA}.event_deliveries
       (delivery_id, subscription_id, tool_id, tool_slug, event_type, source, target_url, payload, status, response_status, response_body, attempts, error, delivered_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      deliveryId, sub.subscription_id, sub.tool_id, toolSlug, envelope.type, source, sub.target_url,
      JSON.stringify(envelope), status, responseStatus, responseBody, attempts, error,
      status === "delivered" ? new Date().toISOString() : null,
    ]
  );

  return { delivery_id: deliveryId, subscription_id: sub.subscription_id, target_url: sub.target_url, status, response_status: responseStatus, attempts, error };
}

/**
 * Persist an event's payload as durable tool state when the tool's event
 * declares a `persist` mapping. Runs on every emit (generator / manual /
 * activity) and independently of subscriptions, so a created resource shows up
 * on the tool's GET endpoints even when nothing is subscribed.
 */
async function persistEvent(input: PublishInput): Promise<void> {
  try {
    const ev = getTool(input.toolId)?.events?.find((e) => e.type === input.eventType);
    if (!ev?.persist) return;
    const id = ev.persist.idOf(input.data);
    if (id != null && String(id) !== "") await putResource(input.toolId, ev.persist.collection, String(id), input.data);
  } catch { /* best effort — never block delivery on persistence */ }
}

export async function publishEvent(input: PublishInput): Promise<PublishResult> {
  const base: PublishResult = { eventType: input.eventType, matched: 0, delivered: 0, failed: 0, deliveries: [] };
  if (!dbAvailable()) return base;

  // Persist first: the event becomes queryable tool state regardless of whether
  // any subscriber exists (this is what "call the API normally and see the same
  // data" relies on).
  await persistEvent(input);

  const subs = (await activeSubscriptions()).filter((s) => matches(s, input.toolId, input.eventType));
  if (subs.length === 0) return base;

  const envelopeBase = {
    type: input.eventType,
    tool: input.toolId,
    source: input.source,
    created_at: new Date().toISOString(),
    data: input.data,
  };

  const results = await Promise.all(
    subs.map((s) => deliver(s, { id: `evt_${randomBytes(8).toString("hex")}`, ...envelopeBase }, input.source, input.toolSlug))
  );
  return {
    eventType: input.eventType,
    matched: subs.length,
    delivered: results.filter((r) => r.status === "delivered").length,
    failed: results.filter((r) => r.status === "failed").length,
    deliveries: results,
  };
}
