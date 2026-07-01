import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, uuid } from "../helpers";

// Nightfall.ai — DLP. Scan text for sensitive findings (PII/PHI/secrets) using
// named detection rules. Findings are derived from the payload so a string with
// an obvious SSN/credit-card/email pattern reliably triggers.

const DETECTORS = [
  { name: "Credit Card Number", type: "CREDIT_CARD_NUMBER", re: /\b(?:\d[ -]?){13,16}\b/ },
  { name: "US Social Security Number", type: "US_SOCIAL_SECURITY_NUMBER", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: "Email Address", type: "EMAIL_ADDRESS", re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { name: "API Key", type: "API_KEY", re: /\b(?:sk|api|key)[-_][A-Za-z0-9]{16,}\b/i },
  { name: "Phone Number", type: "PHONE_NUMBER", re: /\b\+?\d[\d -]{7,}\d\b/ },
] as const;

const CONFIDENCE = ["VERY_LIKELY", "LIKELY", "POSSIBLE"] as const;

function scanText(text: string) {
  const r = rng("nf:" + text.slice(0, 64));
  const findings: any[] = [];
  for (const d of DETECTORS) {
    const m = text.match(d.re);
    if (m && typeof m.index === "number") {
      const frag = m[0];
      findings.push({
        finding: frag.length > 4 ? frag.slice(0, 2) + "***" + frag.slice(-2) : "****",
        redactedFinding: "[" + d.type + "]",
        beforeContext: text.slice(Math.max(0, m.index - 12), m.index),
        afterContext: text.slice(m.index + frag.length, m.index + frag.length + 12),
        detector: { name: d.name, uuid: uuid() },
        confidence: pick(r, CONFIDENCE),
        byteRange: { start: m.index, end: m.index + frag.length },
        matchedDetectionRuleUUIDs: [uuid()],
      });
    }
  }
  return findings;
}

export const nightfall: ToolDef = {
  id: "nightfall",
  name: "Nightfall.ai",
  vendor: "Nightfall",
  category: "dlp",
  crafted: true,
  aiTool: true,
  summary:
    "Nightfall uses AI to discover and redact sensitive data (PII/PHI/secrets) in text and files, preventing data exposure before it reaches downstream systems or LLMs.",
  tags: ["dlp", "pii", "redaction", "secrets", "ai-tool"],
  auth: { type: "bearer" },
  docsUrl: "https://docs.nightfall.ai/reference",
  defaultLatencyMs: 280,
  endpoints: [
    {
      method: "POST",
      path: "/v3/scan",
      operation: "scanText",
      summary: "Scan one or more text payloads for sensitive findings using detection rules.",
      aiTool: true,
      request: {
        payload: ["My SSN is 123-45-6789 and card 4111 1111 1111 1111"],
        config: { detectionRules: [{ name: "default", detectors: [{ detectorType: "NIGHTFALL_DETECTOR", nightfallDetector: "CREDIT_CARD_NUMBER", minConfidence: "POSSIBLE" }] }] },
      },
      respond: (ctx: MockContext): MockResult => {
        const payloads: string[] = ctx.body?.payload || [];
        if (!Array.isArray(payloads)) return { status: 400, body: { code: 400, message: "payload must be an array of strings" } };
        return {
          status: 200,
          body: { findings: payloads.map((p) => scanText(String(p))), redactedPayload: payloads.map(() => null) },
        };
      },
    },
  ],
  events: [
    { type: "finding.detected", summary: "Sensitive data (PII/PHI/secret) was detected in a scanned payload.", sample: () => ({ findings: scanText("Contact a.patel@client.com — SSN 123-45-6789, card 4111 1111 1111 1111"), detectedAt: new Date().toISOString() }) },
  ],
};
