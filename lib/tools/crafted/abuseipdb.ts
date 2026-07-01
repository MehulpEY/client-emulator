import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, chance, COUNTRIES, daysAgoIso, fakeIp } from "../helpers";

// AbuseIPDB — IP reputation by community abuse reports. Score seeded from the IP.

function checkReport(ip: string, maxAgeDays: number) {
  const r = rng("abuse:" + ip);
  const score = int(r, 0, 100);
  const totalReports = score > 25 ? int(r, 1, 940) : int(r, 0, 3);
  const categories = [18, 22, 14, 4, 21, 15];
  return {
    data: {
      ipAddress: ip,
      isPublic: true,
      ipVersion: 4,
      isWhitelisted: score < 5 ? chance(r, 0.4) : false,
      abuseConfidenceScore: score,
      countryCode: pick(r, COUNTRIES),
      usageType: pick(r, ["Data Center/Web Hosting/Transit", "Fixed Line ISP", "Commercial", "University/College/School"]),
      isp: pick(r, ["DigitalOcean, LLC", "Amazon.com, Inc.", "OVH SAS", "Hetzner Online GmbH", "China Telecom"]),
      domain: pick(r, ["digitalocean.com", "amazonaws.com", "ovh.net", "hetzner.com"]),
      hostnames: [],
      isTor: chance(r, 0.08),
      totalReports,
      numDistinctUsers: Math.min(totalReports, int(r, 0, 120)),
      lastReportedAt: totalReports > 0 ? daysAgoIso(int(r, 0, maxAgeDays)) : null,
      reports:
        totalReports > 0
          ? Array.from({ length: Math.min(totalReports, 3) }).map(() => ({
              reportedAt: daysAgoIso(int(r, 0, maxAgeDays)),
              comment: pick(r, ["SSH brute-force attempts", "Port scan detected", "Repeated failed login on WordPress admin", "Hitting honeypot on 445/tcp"]),
              categories: [pick(r, categories), pick(r, categories)],
              reporterId: int(r, 1000, 90000),
              reporterCountryCode: pick(r, COUNTRIES),
            }))
          : [],
    },
  };
}

export const abuseipdb: ToolDef = {
  id: "abuseipdb",
  name: "AbuseIPDB",
  vendor: "Marathon Studios",
  category: "threat-intel",
  crafted: true,
  aiTool: true,
  summary:
    "AbuseIPDB tracks IPs involved in hacking attempts and other malicious activity. Check an address's abuse confidence score, report abusers, and pull the blacklist.",
  tags: ["ip-reputation", "blocklist", "abuse-score", "threat-intel"],
  auth: { type: "api_key_header", param: "Key" },
  docsUrl: "https://docs.abuseipdb.com/",
  defaultLatencyMs: 220,
  endpoints: [
    {
      method: "GET",
      path: "/api/v2/check",
      operation: "checkIp",
      summary: "Check the abuse confidence score for an IP (query: ipAddress, maxAgeInDays).",
      aiTool: true,
      request: { ipAddress: "118.25.6.39", maxAgeInDays: "90" },
      respond: (ctx: MockContext): MockResult => {
        const ip = ctx.query.ipAddress;
        if (!ip) return { status: 422, body: { errors: [{ detail: "The ip address must be a valid IPv4 or IPv6 address.", status: 422 }] } };
        return { status: 200, body: checkReport(ip, Number(ctx.query.maxAgeInDays) || 30) };
      },
    },
    {
      method: "POST",
      path: "/api/v2/report",
      operation: "reportIp",
      summary: "Report an abusive IP with categories and a comment.",
      aiTool: true,
      request: { ip: "127.0.0.1", categories: "18,22", comment: "SSH brute-force" },
      respond: (ctx: MockContext): MockResult => {
        const ip = ctx.body?.ip || ctx.query.ip;
        if (!ip) return { status: 422, body: { errors: [{ detail: "The ip field is required.", status: 422 }] } };
        const r = rng("abuse:" + ip);
        return { status: 200, body: { data: { ipAddress: ip, abuseConfidenceScore: int(r, 20, 100) } } };
      },
    },
    {
      method: "GET",
      path: "/api/v2/blacklist",
      operation: "getBlacklist",
      summary: "Retrieve a list of the most reported IPs (query: confidenceMinimum, limit).",
      request: { confidenceMinimum: "90", limit: "5" },
      respond: (ctx: MockContext): MockResult => {
        const limit = Math.min(Number(ctx.query.limit) || 10, 50);
        const r = rng("abuse:blacklist:" + limit);
        return {
          status: 200,
          body: {
            meta: { generatedAt: daysAgoIso(0) },
            data: Array.from({ length: limit }).map(() => ({
              ipAddress: fakeIp(r),
              countryCode: pick(r, COUNTRIES),
              abuseConfidenceScore: int(r, Number(ctx.query.confidenceMinimum) || 90, 100),
              lastReportedAt: daysAgoIso(int(r, 0, 2)),
            })),
          },
        };
      },
    },
  ],
  events: [
    { type: "report.received", summary: "A new abuse report was filed against an IP.", sample: () => checkReport(fakeIp(rng(String(Date.now()))), 90) },
  ],
};
