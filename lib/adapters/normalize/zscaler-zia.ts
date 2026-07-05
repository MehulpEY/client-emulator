// Zscaler Internet Access normalizer (PLAN §4.4): end users from GET /users
// (root array). Email is the correlation key; department/groups are nested
// { id, name } objects flattened to their names.

import type { NormalizedRecord, Normalizer } from "../types";
import { asObject, fields, lower, str } from "./util";

const normalize: Normalizer = (_step, records) => {
  const out: NormalizedRecord[] = [];
  for (const item of records) {
    const rec = asObject(item);
    if (!rec) continue;
    const externalId = str(rec.id);
    if (!externalId) continue;
    const name = str(rec.name);
    const email = str(rec.email);
    const groups = Array.isArray(rec.groups)
      ? rec.groups.map((g) => str(asObject(g)?.name)).filter(Boolean).join(", ")
      : undefined;
    out.push({
      assetType: "user",
      externalId,
      displayName: name ?? email ?? externalId,
      email: lower(email),
      fields: fields({
        name,
        email,
        department: asObject(rec.department)?.name,
        groups,
        adminUser: typeof rec.adminUser === "boolean" ? rec.adminUser : undefined,
      }),
      raw: rec,
    });
  }
  return out;
};

export default normalize;
