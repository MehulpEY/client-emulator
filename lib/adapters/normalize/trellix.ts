// Trellix ePO normalizer (PLAN §4.4): managed systems from GET /remote/system.find.
// ePO rows use dotted column names ("EPOComputerProperties.ComputerName"); the
// OK:-prefixed wire envelope is already stripped by the fetch extractor.
// NetAddress is a bare mac (no separators) -> canonical colon form.

import type { NormalizedRecord, Normalizer } from "../types";
import { asObject, canonicalMac, fields, lower, str } from "./util";

const P = "EPOComputerProperties.";
const L = "EPOLeafNode.";

const normalize: Normalizer = (_step, records) => {
  const out: NormalizedRecord[] = [];
  for (const item of records) {
    const rec = asObject(item);
    if (!rec) continue;
    const name = str(rec[P + "ComputerName"]) ?? str(rec[L + "NodeName"]);
    const externalId = str(rec[L + "AgentGUID"]) ?? str(rec[L + "AutoID"]) ?? name;
    if (!externalId) continue;
    const serial = str(rec[P + "SystemSerialNumber"]); // added by W4
    const mac = canonicalMac(rec[P + "NetAddress"]);    // bare "AABBCCDDEEFF" -> aa:bb:cc:dd:ee:ff
    out.push({
      assetType: "device",
      externalId,
      displayName: name ?? externalId,
      hostname: lower(name),
      mac,
      serial,
      fields: fields({
        hostname: name,
        fqdn: rec[P + "IPHostName"],
        serial,
        mac,
        ip: rec[P + "IPAddress"],
        os: rec[P + "OSType"],
        osVersion: rec[P + "OSVersion"],
        user: rec[P + "UserName"],
        lastSeen: rec[L + "LastUpdate"] ?? rec[P + "LastUpdate"],
        agentVersion: rec[L + "AgentVersion"],
        tags: rec[L + "Tags"],
      }),
      raw: rec,
    });
  }
  return out;
};

export default normalize;
