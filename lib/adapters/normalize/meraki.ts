// Cisco Meraki normalizer (PLAN §4.4): org device inventory from
// GET /organizations/{organizationId}/devices (root array). The serial is
// Meraki's device identity; `model` doubles as the os field for network gear.

import type { NormalizedRecord, Normalizer } from "../types";
import { asObject, canonicalMac, fields, lower, str } from "./util";

const normalize: Normalizer = (_step, records) => {
  const out: NormalizedRecord[] = [];
  for (const item of records) {
    const rec = asObject(item);
    if (!rec) continue;
    const serial = str(rec.serial);
    if (!serial) continue;
    const name = str(rec.name);
    const mac = canonicalMac(rec.mac);
    out.push({
      assetType: "device",
      externalId: serial,
      displayName: name ?? serial,
      hostname: lower(name),
      mac,
      serial,
      fields: fields({
        name,
        serial,
        mac,
        os: rec.model, // model is the closest thing network gear has to an OS
        ip: rec.lanIp,
        firmware: rec.firmware,
        productType: rec.productType,
        networkId: rec.networkId,
        address: rec.address,
        tags: rec.tags,
      }),
      raw: rec,
    });
  }
  return out;
};

export default normalize;
