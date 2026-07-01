import { uuid, shortId, nowIso, unixNow, rng, fakeIp } from "../tools/helpers";

/**
 * Expand template tokens inside a `responseExample` so scaffolded tools still
 * return fresh-looking ids/timestamps each call. Tokens:
 *   {{uuid}} {{shortId}} {{now}} {{unix}} {{ip}}
 * Walks the value deeply; replaces tokens embedded anywhere in a string.
 */
export function expandTemplates<T = any>(value: T): T {
  const r = rng(uuid());
  const replaceStr = (s: string): string =>
    s
      .replace(/\{\{uuid\}\}/g, () => uuid())
      .replace(/\{\{shortId\}\}/g, () => shortId(""))
      .replace(/\{\{now\}\}/g, () => nowIso())
      .replace(/\{\{unix\}\}/g, () => String(unixNow()))
      .replace(/\{\{ip\}\}/g, () => fakeIp(r));

  const walk = (v: any): any => {
    if (typeof v === "string") return replaceStr(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}
