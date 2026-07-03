// Synthetic-data helpers for the mock engine. Where it adds realism, generators
// seed a small PRNG from the request input so the same lookup (e.g. a given file
// hash) yields a stable verdict across calls - like a real reputation service.

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 - tiny deterministic PRNG. */
export function rng(seed: number | string) {
  let a = typeof seed === "string" ? hashStr(seed) : seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RNG = () => number;

export const pick = <T>(r: RNG, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
export const int = (r: RNG, min: number, max: number): number => Math.floor(r() * (max - min + 1)) + min;
export const chance = (r: RNG, p: number): boolean => r() < p;
export const sample = <T>(r: RNG, arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
  return out;
};

const HEX = "0123456789abcdef";
function hex(r: RNG, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += HEX[Math.floor(r() * 16)];
  return s;
}
export const fakeSha256 = (seed: string): string => hex(rng("sha256:" + seed), 64);
export const fakeSha1 = (seed: string): string => hex(rng("sha1:" + seed), 40);
export const fakeMd5 = (seed: string): string => hex(rng("md5:" + seed), 32);

export function fakeIp(r: RNG): string {
  return `${int(r, 1, 223)}.${int(r, 0, 255)}.${int(r, 0, 255)}.${int(r, 1, 254)}`;
}

export function uuid(): string {
  // Node 18+ / web crypto.
  try {
    return crypto.randomUUID();
  } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

/** Short hex id, e.g. for task / scan / job ids. */
export const shortId = (prefix = ""): string => prefix + hex(rng(uuid()), 16);

export const nowIso = (): string => new Date().toISOString();
export const minutesAgoIso = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
export const daysAgoIso = (d: number): string => new Date(Date.now() - d * 86_400_000).toISOString();
export const unixNow = (): number => Math.floor(Date.now() / 1000);

export const COUNTRIES = ["US", "RU", "CN", "DE", "NL", "BR", "IN", "GB", "FR", "UA", "VN", "IR", "KP", "SG"] as const;
export const MALWARE_FAMILIES = ["Emotet", "TrickBot", "AgentTesla", "Qakbot", "RedLine", "Cobalt Strike", "Mirai", "njRAT", "Formbook", "Lokibot"] as const;
export const AV_ENGINES = ["Kaspersky", "BitDefender", "ESET-NOD32", "Microsoft", "Sophos", "McAfee", "Symantec", "TrendMicro", "Avast", "ClamAV", "CrowdStrike", "SentinelOne"] as const;
export const HOSTNAMES = ["WIN-FIN-07", "DESKTOP-A19QK", "LT-SALES-22", "SRV-DC01", "MAC-DEV-03", "WIN-HR-14", "SRV-APP-09", "LT-EXEC-01"] as const;
export const USERS = ["a.patel", "j.smith", "m.garcia", "s.kim", "r.jones", "k.nguyen", "t.brown", "l.wang"] as const;
