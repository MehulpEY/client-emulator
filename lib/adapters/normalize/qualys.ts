// Qualys VMDR normalizer (PLAN §4.4). Qualys' XML-derived JSON uses UPPERCASE
// keys and wraps lists ({ HOST_LIST: { HOST: [...] } } — the fetch extractor
// unwraps the outer level; DETECTION_LIST is unwrapped here).
// - hosts:      GET /api/2.0/fo/asset/host/               -> HOST records
// - detections: GET /api/2.0/fo/asset/host/vm/detection/  -> HOST records, each
//   expanded to one vulnerability record per detection (QID + host).

import type { NormalizedRecord, Normalizer } from "../types";
import { asObject, canonicalMac, fields, hostLabel, lower, str } from "./util";

/** DETECTION_LIST may be a bare array, { DETECTION: [...] }, or a collapsed single object. */
function detectionsOf(host: Record<string, unknown>): Record<string, unknown>[] {
  let list: unknown = host.DETECTION_LIST;
  const wrapped = asObject(list);
  if (wrapped) list = wrapped.DETECTION ?? Object.values(wrapped).find(Array.isArray) ?? wrapped;
  if (Array.isArray(list)) return list.map(asObject).filter((d): d is Record<string, unknown> => !!d);
  const single = asObject(list);
  return single ? [single] : [];
}

function host(rec: Record<string, unknown>): NormalizedRecord | null {
  const externalId = str(rec.ID);
  if (!externalId) return null;
  const dns = str(rec.DNS);
  const short = hostLabel(dns); // "lt-fin-012.corp.local" -> "lt-fin-012" so the key matches EDR hostnames
  const serial = str(rec.SERIAL_NUMBER); // added by W4
  const mac = canonicalMac(rec.MAC_ADDRESS); // added by W4
  return {
    assetType: "device",
    externalId,
    displayName: short ?? dns ?? externalId,
    hostname: lower(short),
    mac,
    serial,
    fields: fields({
      hostname: short,
      fqdn: dns,
      serial,
      mac,
      ip: rec.IP,
      os: rec.OS,
      netbios: rec.NETBIOS,
      lastScan: rec.LAST_VULN_SCAN_DATETIME ?? rec.LAST_SCAN_DATETIME,
    }),
    raw: rec,
  };
}

function hostDetections(rec: Record<string, unknown>): NormalizedRecord[] {
  const hostId = str(rec.ID);
  const dns = str(rec.DNS);
  const short = hostLabel(dns);
  const out: NormalizedRecord[] = [];
  for (const det of detectionsOf(rec)) {
    const qid = str(det.QID);
    if (!hostId || !qid) continue;
    const title = str(det.TITLE);
    out.push({
      assetType: "vulnerability",
      // Stable per (host, QID) so re-fetches upsert instead of duplicating.
      externalId: `${hostId}:${qid}`,
      displayName: `${title ?? `QID ${qid}`} on ${short ?? dns ?? hostId}`,
      hostname: lower(short),
      fields: fields({
        qid,
        cve: det.CVE,
        title,
        severity: det.SEVERITY,
        status: det.STATUS,
        type: det.TYPE,
        hostname: short,
        ip: rec.IP,
        os: rec.OS,
        firstFound: det.FIRST_FOUND_DATETIME,
        lastFound: det.LAST_FOUND_DATETIME,
      }),
      raw: { ...det, HOST_ID: rec.ID, DNS: rec.DNS, IP: rec.IP },
    });
  }
  return out;
}

const normalize: Normalizer = (step, records) => {
  const out: NormalizedRecord[] = [];
  for (const item of records) {
    const rec = asObject(item);
    if (!rec) continue;
    if (step.assetType === "vulnerability") out.push(...hostDetections(rec));
    else {
      const n = host(rec);
      if (n) out.push(n);
    }
  }
  return out;
};

export default normalize;
