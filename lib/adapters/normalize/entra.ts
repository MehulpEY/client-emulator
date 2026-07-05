// Microsoft Entra ID (Graph) normalizer (PLAN §4.4): directory users from
// GET /v1.0/users -> value[]. The UPN is the correlation email.

import type { NormalizedRecord, Normalizer } from "../types";
import { asObject, fields, lower, str } from "./util";

const normalize: Normalizer = (_step, records) => {
  const out: NormalizedRecord[] = [];
  for (const item of records) {
    const rec = asObject(item);
    if (!rec) continue;
    const externalId = str(rec.id);
    if (!externalId) continue;
    const upn = str(rec.userPrincipalName);
    const displayName = str(rec.displayName);
    out.push({
      assetType: "user",
      externalId,
      displayName: displayName ?? upn ?? externalId,
      email: lower(upn ?? rec.mail),
      fields: fields({
        displayName,
        upn,
        mail: rec.mail,
        department: rec.department,
        jobTitle: rec.jobTitle,
        accountEnabled: typeof rec.accountEnabled === "boolean" ? rec.accountEnabled : undefined,
        officeLocation: rec.officeLocation,
      }),
      raw: rec,
    });
  }
  return out;
};

export default normalize;
