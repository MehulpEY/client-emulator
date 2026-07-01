import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, fakeIp, minutesAgoIso, unixNow, uuid } from "../helpers";

// IBM QRadar — SIEM. Offenses + Ariel (AQL) searches.

const OFFENSE_TYPES = ["Source IP", "Destination IP", "Username", "Hostname", "Event Name"] as const;
const DESCRIPTIONS = [
  "Multiple Login Failures for Single Username",
  "Possible Data Exfiltration to Suspicious Host",
  "Malware Detected by Endpoint",
  "Excessive Firewall Denies from Single Source",
  "Privileged Account Used from New Geography",
] as const;

function offense(id: number) {
  const r = rng("qr:off:" + id);
  const magnitude = int(r, 3, 10);
  return {
    id,
    description: pick(r, DESCRIPTIONS),
    offense_type: int(r, 0, 4),
    offense_source: pick(r, [fakeIp(r), "a.patel", "WIN-FIN-07"]),
    magnitude,
    severity: int(r, 3, 10),
    credibility: int(r, 2, 10),
    relevance: int(r, 1, 10),
    status: pick(r, ["OPEN", "OPEN", "HIDDEN", "CLOSED"]),
    categories: pick(r, [["Authentication"], ["Malware"], ["Exfiltration", "Anomaly"], ["Suspicious Activity"]]),
    event_count: int(r, 5, 24000),
    flow_count: int(r, 0, 1500),
    source_count: int(r, 1, 12),
    local_destination_count: int(r, 1, 30),
    assigned_to: pick(r, ["soc_analyst1", null, "tier2_queue"]),
    start_time: unixNow() * 1000 - int(r, 60000, 86400000),
    last_updated_time: unixNow() * 1000 - int(r, 1000, 60000),
  };
}

export const qradar: ToolDef = {
  id: "qradar",
  name: "IBM QRadar",
  vendor: "IBM",
  category: "siem",
  crafted: true,
  aiTool: true,
  summary:
    "IBM QRadar SIEM centralizes log and network-flow data to detect and investigate threats in real time, surfacing correlated offenses for analysts.",
  tags: ["siem", "offenses", "aql", "ariel", "correlation"],
  auth: { type: "api_key_header", param: "SEC" },
  docsUrl: "https://www.ibm.com/docs/en/qradar-common?topic=api-rest-overview",
  defaultLatencyMs: 400,
  endpoints: [
    {
      method: "GET",
      path: "/api/siem/offenses",
      operation: "listOffenses",
      summary: "List offenses (query: filter, fields, Range header).",
      aiTool: true,
      request: { filter: "status = OPEN", Range: "items=0-4" },
      respond: (ctx: MockContext): MockResult => {
        const r = rng("qr:list:" + (ctx.query.filter || ""));
        const n = int(r, 3, 8);
        return { status: 200, body: Array.from({ length: n }).map(() => offense(int(r, 1000, 99999))) };
      },
    },
    {
      method: "GET",
      path: "/api/siem/offenses/{offense_id}",
      operation: "getOffense",
      summary: "Retrieve a single offense by id.",
      aiTool: true,
      request: { offense_id: "42" },
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: offense(Number(ctx.params.offense_id) || 1) }),
    },
    {
      method: "POST",
      path: "/api/siem/offenses/{offense_id}",
      operation: "updateOffense",
      summary: "Update an offense (assign, close, set status — query: status, assigned_to, closing_reason_id).",
      aiTool: true,
      request: { offense_id: "42", status: "CLOSED", closing_reason_id: "1" },
      respond: (ctx: MockContext): MockResult => {
        const o = offense(Number(ctx.params.offense_id) || 1);
        return { status: 200, body: { ...o, status: (ctx.query.status || "OPEN").toUpperCase(), assigned_to: ctx.query.assigned_to ?? o.assigned_to } };
      },
    },
    {
      method: "POST",
      path: "/api/ariel/searches",
      operation: "createSearch",
      summary: "Start an Ariel (AQL) search. Returns a search_id to poll for results.",
      request: { query_expression: "SELECT * FROM events WHERE magnitude > 5 LAST 1 HOURS" },
      respond: (): MockResult => ({
        status: 201,
        body: { search_id: uuid(), status: "EXECUTE", query_string: "SELECT * FROM events LAST 1 HOURS", record_count: 0, progress: 0 },
      }),
    },
    {
      method: "GET",
      path: "/api/ariel/searches/{search_id}/results",
      operation: "getSearchResults",
      summary: "Fetch the results of a completed Ariel search.",
      request: { search_id: "<uuid>" },
      respond: (ctx: MockContext): MockResult => {
        const r = rng("qr:res:" + ctx.params.search_id);
        const n = int(r, 3, 10);
        return {
          status: 200,
          body: {
            events: Array.from({ length: n }).map(() => ({
              starttime: minutesAgoIso(int(r, 1, 120)),
              sourceip: fakeIp(r),
              destinationip: fakeIp(r),
              username: pick(r, ["a.patel", "svc_backup", "administrator", "j.smith"]),
              "qid_name": pick(r, ["Authentication Failed", "Object Accessed", "Firewall Deny", "Process Created"]),
              magnitude: int(r, 1, 10),
            })),
          },
        };
      },
    },
  ],
  events: [
    { type: "offense.created", summary: "A new correlated offense was opened.", sample: () => offense(int(rng(uuid()), 1000, 99999)) },
  ],
};
