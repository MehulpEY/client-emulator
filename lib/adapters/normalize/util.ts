// ============================================================================
// Shared helpers for the per-tool normalizers (W3, PLAN §4.4). Small, pure
// coercion utilities so every normalizer emits the same canonical shapes:
// correlation keys lowercased, macs as aa:bb:cc:dd:ee:ff, `fields` flat and
// human-readable, `raw` untouched.
// ============================================================================

/** Coerce a vendor value to a non-empty string (numbers allowed), else undefined. */
export function str(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? undefined : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Lowercased non-empty string (for correlation keys), else undefined. */
export function lower(v: unknown): string | undefined {
  const s = str(v);
  return s ? s.toLowerCase() : undefined;
}

/**
 * Canonical mac: strips any separator style (CrowdStrike `aa-bb-...`, Trellix
 * bare `AABB...`, Meraki `aa:bb:...`) and re-joins as lowercase
 * aa:bb:cc:dd:ee:ff. Anything that isn't 12 hex digits comes back undefined.
 */
export function canonicalMac(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const hex = s.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length !== 12) return undefined;
  return hex.match(/.{2}/g)!.join(":");
}

/** First DNS label ("lt-fin-012.corp.local" -> "lt-fin-012"); bare names pass through. */
export function hostLabel(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  return s.split(".")[0] || undefined;
}

export type FieldValue = string | number | boolean | null;

/**
 * Build the flat, human-readable `fields` map: keeps primitives, joins arrays
 * of primitives with ", ", drops null/undefined/objects. Key order preserved.
 */
export function fields(pairs: Record<string, unknown>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      if (v.trim() === "") continue;
      out[k] = v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (Array.isArray(v)) {
      const joined = v.filter((x) => typeof x === "string" || typeof x === "number").join(", ");
      if (joined) out[k] = joined;
    }
  }
  return out;
}

/** Narrow an unknown vendor record to a plain object (skip strings/nulls/arrays). */
export function asObject(rec: unknown): Record<string, unknown> | null {
  return rec !== null && typeof rec === "object" && !Array.isArray(rec) ? (rec as Record<string, unknown>) : null;
}
