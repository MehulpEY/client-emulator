// CrowdStrike Falcon normalizer (PLAN §4.4).
// - devices:        GET /devices/entities/devices/v2  -> resources[] full host records
// - vulnerabilities: GET /spotlight/queries/vulnerabilities/v1 -> resources[] (W4 turns
//   the id list into full records; pre-W4 string ids are skipped defensively).

import type { NormalizedRecord, Normalizer } from "../types";
import { asObject, canonicalMac, fields, lower, str } from "./util";

function device(rec: Record<string, unknown>): NormalizedRecord | null {
  const externalId = str(rec.device_id);
  if (!externalId) return null;
  const hostname = str(rec.hostname);
  const mac = canonicalMac(rec.mac_address); // Falcon reports dash-separated macs
  const serial = str(rec.serial_number);
  return {
    assetType: "device",
    externalId,
    displayName: hostname ?? externalId,
    hostname: lower(hostname),
    mac,
    serial,
    fields: fields({
      hostname,
      serial,
      mac,
      os: rec.os_version,
      platform: rec.platform_name,
      ip: rec.local_ip,
      lastSeen: rec.last_seen,
      agentVersion: rec.agent_version,
      status: rec.status,
      tags: rec.tags,
    }),
    raw: rec,
  };
}

function vulnerability(rec: Record<string, unknown>): NormalizedRecord | null {
  const externalId = str(rec.id);
  if (!externalId) return null;
  // W4 contract: cve_id/severity/score at the top level; tolerate the richer
  // Spotlight entity shape (cve: { id, severity, base_score }) as a fallback.
  const cveObj = asObject(rec.cve);
  const cve = str(rec.cve_id) ?? str(cveObj?.id);
  const hostInfo = asObject(rec.host_info);
  const hostname = str(hostInfo?.hostname);
  return {
    assetType: "vulnerability",
    externalId,
    displayName: cve ? (hostname ? `${cve} on ${hostname}` : cve) : externalId,
    hostname: lower(hostname),
    fields: fields({
      cve,
      severity: rec.severity ?? cveObj?.severity,
      status: rec.status,
      score: rec.score ?? cveObj?.base_score,
      hostname,
      ip: hostInfo?.local_ip,
      os: hostInfo?.os_version,
    }),
    raw: rec,
  };
}

const normalize: Normalizer = (step, records) => {
  const out: NormalizedRecord[] = [];
  for (const item of records) {
    const rec = asObject(item);
    if (!rec) continue; // pre-W4 the vulnerability query returns bare id strings
    const n = step.assetType === "vulnerability" ? vulnerability(rec) : device(rec);
    if (n) out.push(n);
  }
  return out;
};

export default normalize;
