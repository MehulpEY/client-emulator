// Generic fallback normalizer — the PLAN §6 (W6) contract. Any adapter without
// a hand-written normalizer (the 8 scaffolds and future ones) must emit records
// carrying these fields at the TOP LEVEL of each record, nested under the
// declared recordsPath:  id, hostname/name, mac, serial, email, os, ip, lastSeen.
// This is what keeps W6 independent of W3.

import type { NormalizedRecord, Normalizer } from "../types";
import { asObject, canonicalMac, fields, lower, str, type FieldValue } from "./util";

const MAX_FIELDS = 24;

/** All primitive top-level props (arrays of primitives joined), capped for readability. */
function genericFields(rec: Record<string, unknown>): Record<string, FieldValue> {
  const all = fields(rec);
  const out: Record<string, FieldValue> = {};
  let n = 0;
  for (const [k, v] of Object.entries(all)) {
    if (n >= MAX_FIELDS) break;
    out[k] = v;
    n++;
  }
  return out;
}

const normalize: Normalizer = (step, records) => {
  const out: NormalizedRecord[] = [];
  for (const item of records) {
    const rec = asObject(item);
    if (!rec) continue;
    const hostname = str(rec.hostname);
    const name = str(rec.name);
    const serial = str(rec.serial);
    const mac = canonicalMac(rec.mac);
    const email = str(rec.email);
    // Stable identity or nothing: an index-based id would duplicate on re-fetch.
    const externalId = str(rec.id) ?? serial ?? mac ?? email ?? hostname ?? name;
    if (!externalId) continue;
    const isUser = step.assetType === "user";
    const displayName =
      (isUser ? name ?? email : hostname ?? name) ?? name ?? email ?? externalId;
    out.push({
      assetType: step.assetType,
      externalId,
      displayName,
      // `name` doubles as the hostname for devices only — for users it's a person.
      hostname: lower(isUser ? hostname : hostname ?? name),
      mac,
      serial,
      email: lower(email),
      fields: genericFields(rec),
      raw: rec,
    });
  }
  return out;
};

export default normalize;
