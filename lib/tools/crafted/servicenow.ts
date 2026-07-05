import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, chance, minutesAgoIso, daysAgoIso, nowIso, uuid } from "../helpers";
import { fleetDevices, ownerOf, extId, macColon, type FleetDevice } from "../../fleet/fleet";

// ServiceNow CMDB via the Table API (scaffold adapter). HTTP Basic auth.
// Responses use ServiceNow's { result: ... } envelope. The cmdb_ci_computer
// table projects the ENTIRE canonical fleet (lib/fleet/fleet.ts) - laptops,
// servers AND network gear - so CIs correlate with every other adapter on
// serial/mac/hostname and the CMDB acts as the widest source of truth. Every
// record keeps the generic-normalizer keys (id / hostname / mac / serial /
// os / ip / lastSeen) at the top level alongside ServiceNow's snake_case
// CI fields (sys_id, serial_number, mac_address, ip_address, ...).

/** 32-hex ServiceNow sys_id derived from extId. */
const sysIdOf = (fleetId: string): string => extId("servicenow", fleetId, 32);

const MANUFACTURERS: Record<FleetDevice["platform"], readonly [string, string][]> = {
  windows: [["Dell Inc.", "Latitude 7440"], ["LENOVO", "ThinkPad X1 Carbon Gen 11"], ["HP", "EliteBook 840 G10"]],
  mac: [["Apple Inc.", "MacBook Pro 14\""], ["Apple Inc.", "MacBook Air M2"]],
  linux: [["Dell Inc.", "PowerEdge R650"], ["Supermicro", "SYS-120U-TNR"]],
  network: [["Cisco Meraki", "MR46"], ["Cisco Meraki", "MS250-48"], ["Cisco Meraki", "MX85"]],
};

/** Project one fleet device into a cmdb_ci_computer row (+ generic keys). */
function snComputer(d: FleetDevice) {
  const r = rng("snow:ci:" + d.fleetId);
  const owner = ownerOf(d);
  const lastDiscovered = minutesAgoIso(int(r, 30, 4320));
  const [manufacturer, model] = pick(r, MANUFACTURERS[d.platform]);
  const isServer = d.hostname.startsWith("SRV-");
  return {
    // generic normalizer contract (top level)
    id: sysIdOf(d.fleetId),
    hostname: d.hostname,
    mac: macColon(d.mac),
    serial: d.serial,
    os: d.os,
    ip: d.ip,
    lastSeen: lastDiscovered,
    // ServiceNow CI surface
    sys_id: sysIdOf(d.fleetId),
    name: d.hostname,
    sys_class_name: d.platform === "network" ? "cmdb_ci_netgear" : isServer ? "cmdb_ci_server" : "cmdb_ci_computer",
    serial_number: d.serial,
    mac_address: macColon(d.mac).toUpperCase(),
    ip_address: d.ip,
    os_version: d.os.match(/(\d+(\.\d+)+)/)?.[1] ?? "",
    asset_tag: "P" + String(int(r, 100000, 999999)),
    install_status: "1",
    manufacturer,
    model_id: model,
    location: d.site,
    assigned_to: owner?.displayName ?? "",
    department: owner?.department ?? "",
    virtual: isServer ? String(chance(r, 0.5)) : "false",
    cpu_count: String(pick(r, [4, 8, 16] as const)),
    ram: String(pick(r, [16384, 32768, 65536] as const)),
    discovery_source: "ServiceNow Discovery",
    first_discovered: daysAgoIso(int(r, 60, 900)),
    last_discovered: lastDiscovered,
    sys_created_on: daysAgoIso(int(r, 60, 900)),
    sys_updated_on: lastDiscovered,
  };
}

type SnComputer = ReturnType<typeof snComputer>;

/** Apply sysparm_fields projection (comma-separated key list). */
function projectFields(row: SnComputer, fields?: string): Record<string, unknown> {
  if (!fields) return row;
  const keep = new Set(fields.split(",").map((f) => f.trim()).filter(Boolean));
  return Object.fromEntries(Object.entries(row).filter(([k]) => keep.has(k)));
}

const sn404: MockResult = {
  status: 404,
  body: { error: { message: "No Record found", detail: "Record doesn't exist or ACL restricts the record retrieval" }, status: "failure" },
};

export const serviceNow: ToolDef = {
  id: "servicenow",
  name: "ServiceNow CMDB",
  vendor: "ServiceNow",
  category: "itam",
  crafted: false,
  summary:
    "ServiceNow CMDB via the Table API - cmdb_ci_computer configuration items covering the entire fleet (endpoints, servers and network gear) with read, get and PATCH update operations.",
  tags: ["itam", "cmdb", "servicenow", "table-api", "configuration-items", "inventory"],
  auth: { type: "basic" },
  docsUrl: "https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/c_TableAPI",
  defaultLatencyMs: 300,
  endpoints: [
    {
      method: "GET",
      path: "/api/now/table/cmdb_ci_computer",
      operation: "listComputers",
      summary: "List computer CIs - body { result: [...] }. Projects the entire fleet including network gear.",
      request: { sysparm_limit: "10" },
      params: [
        { name: "sysparm_query", in: "query", type: "string", description: "Encoded query. Supports name=<value>, sys_class_name=<value> and nameLIKE<substring>.", format: "ServiceNow encoded query", example: "nameLIKESRV" },
        { name: "sysparm_limit", in: "query", type: "integer", description: "Max records to return.", default: 100, example: 10 },
        { name: "sysparm_offset", in: "query", type: "integer", description: "Number of records to skip for pagination.", default: 0 },
        { name: "sysparm_fields", in: "query", type: "string", description: "Comma-separated field list to return.", example: "sys_id,name,serial_number,ip_address" },
      ],
      respond: (ctx: MockContext): MockResult => {
        let rows = fleetDevices().map(snComputer);
        const query = ctx.query.sysparm_query || "";
        const like = /nameLIKE(.+)/.exec(query);
        const nameEq = /(?:^|\^)name=([^^]+)/.exec(query);
        const classEq = /(?:^|\^)sys_class_name=([^^]+)/.exec(query);
        if (like) rows = rows.filter((c) => c.name.toLowerCase().includes(like[1].toLowerCase()));
        if (nameEq) rows = rows.filter((c) => c.name.toLowerCase() === nameEq[1].toLowerCase());
        if (classEq) rows = rows.filter((c) => c.sys_class_name === classEq[1]);
        const offset = Math.max(0, Number(ctx.query.sysparm_offset) || 0);
        const limit = Math.max(1, Number(ctx.query.sysparm_limit) || 100);
        const result = rows.slice(offset, offset + limit).map((row) => projectFields(row, ctx.query.sysparm_fields));
        return { status: 200, body: { result } };
      },
    },
    {
      method: "GET",
      path: "/api/now/table/cmdb_ci_computer/{sysId}",
      operation: "getComputer",
      summary: "Get a single computer CI by sys_id - body { result: {...} }.",
      request: { sysId: "<32-hex sys_id>" },
      params: [
        { name: "sysId", in: "path", type: "string", required: true, description: "sys_id of the CI to retrieve.", format: "32-character hex sys_id", example: "46d44a5dc0a8010e0000c8a06e05" },
        { name: "sysparm_fields", in: "query", type: "string", description: "Comma-separated field list to return.", example: "sys_id,name,serial_number" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const d = fleetDevices().find((f) => sysIdOf(f.fleetId) === ctx.params.sysId);
        if (!d) return sn404;
        return { status: 200, body: { result: projectFields(snComputer(d), ctx.query.sysparm_fields) } };
      },
    },
    {
      method: "PATCH",
      path: "/api/now/table/cmdb_ci_computer/{sysId}",
      operation: "updateComputer",
      summary: "Update fields on a computer CI (e.g. assigned_to, location, install_status).",
      emits: "ci.updated",
      request: { sysId: "<32-hex sys_id>", assigned_to: "Ava Sharma", location: "LON-01" },
      params: [
        { name: "sysId", in: "path", type: "string", required: true, description: "sys_id of the CI to update.", format: "32-character hex sys_id", example: "46d44a5dc0a8010e0000c8a06e05" },
        { name: "assigned_to", in: "body", type: "string", description: "Person the CI is assigned to.", example: "Ava Sharma" },
        { name: "location", in: "body", type: "string", description: "Site/location of the CI.", example: "LON-01" },
        { name: "install_status", in: "body", type: "string", description: "Lifecycle state of the CI.", enum: ["1", "3", "6", "7"], format: "1=Installed, 3=In maintenance, 6=In stock, 7=Retired" },
        { name: "asset_tag", in: "body", type: "string", description: "Physical asset tag.", example: "P704325" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const d = fleetDevices().find((f) => sysIdOf(f.fleetId) === ctx.params.sysId);
        if (!d) return sn404;
        const patch = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
        const result = { ...snComputer(d), ...patch, sys_id: ctx.params.sysId, sys_updated_on: nowIso() };
        return { status: 200, body: { result } };
      },
    },
  ],
  events: [
    {
      type: "ci.updated",
      summary: "A configuration item was updated in the CMDB.",
      sample: () => {
        const d = pick(rng("snow:evt:" + uuid()), fleetDevices());
        return { ...snComputer(d), sys_updated_on: nowIso(), sys_updated_by: "cmdb.integration" };
      },
    },
  ],
};
