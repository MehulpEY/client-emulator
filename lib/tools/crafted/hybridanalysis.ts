import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, sample, fakeSha256, fakeIp, MALWARE_FAMILIES, COUNTRIES, minutesAgoIso, uuid } from "../helpers";

// Hybrid Analysis (Falcon Sandbox) — submit files/URLs, poll, get the report.

const MITRE = [
  { tactic: "Defense Evasion", technique: "Obfuscated Files or Information", attck_id: "T1027" },
  { tactic: "Discovery", technique: "System Information Discovery", attck_id: "T1082" },
  { tactic: "Execution", technique: "Command and Scripting Interpreter", attck_id: "T1059" },
  { tactic: "Persistence", technique: "Registry Run Keys", attck_id: "T1547.001" },
] as const;

function summary(jobId: string) {
  const r = rng("ha:" + jobId);
  const threatScore = int(r, 0, 100);
  const verdict = threatScore > 70 ? "malicious" : threatScore > 40 ? "suspicious" : "no specific threat";
  return {
    job_id: jobId,
    sha256: fakeSha256(jobId),
    environment_id: 100,
    environment_description: "Windows 7 64 bit",
    threat_score: threatScore,
    threat_level: threatScore > 70 ? 2 : threatScore > 40 ? 1 : 0,
    verdict,
    type: pick(r, ["PE32 executable", "PDF document", "MS Office", "Script"]),
    size: int(r, 20000, 6000000),
    submit_name: pick(r, ["invoice.exe", "scan_0921.pdf", "order_details.xlsm"]),
    analysis_start_time: minutesAgoIso(int(r, 2, 30)),
    av_detect: int(r, 0, 70),
    vx_family: threatScore > 40 ? pick(r, MALWARE_FAMILIES) : null,
    classification_tags: threatScore > 40 ? sample(r, ["ransomware", "trojan", "stealer", "loader", "rat"], 2) : [],
    mitre_attcks: sample(r, MITRE, int(r, 1, 3)),
    hosts: Array.from({ length: int(r, 0, 3) }).map(() => fakeIp(r)),
    domains: threatScore > 40 ? sample(r, ["update-cdn.net", "tracking.evil.ru", "pastebin.com", "discord.com"], 2) : [],
    compromised_hosts: [],
    total_network_connections: int(r, 0, 40),
    total_processes: int(r, 1, 25),
    country: pick(r, COUNTRIES),
  };
}

export const hybridanalysis: ToolDef = {
  id: "hybrid-analysis",
  name: "Hybrid Analysis",
  vendor: "CrowdStrike (Falcon Sandbox)",
  category: "forensics",
  crafted: true,
  aiTool: true,
  summary:
    "Hybrid Analysis is a cloud malware-analysis service that detonates suspicious files and URLs in a sandbox, combining static and dynamic analysis into a threat report.",
  tags: ["sandbox", "malware", "detonation", "mitre", "forensics"],
  auth: { type: "api_key_header", param: "api-key" },
  docsUrl: "https://www.hybrid-analysis.com/docs/api/v2",
  defaultLatencyMs: 700,
  endpoints: [
    {
      method: "POST",
      path: "/api/v2/submit/file",
      operation: "submitFile",
      summary: "Submit a file for sandbox detonation. Returns a job_id + sha256.",
      aiTool: true,
      request: { file: "<binary>", environment_id: 100 },
      respond: (): MockResult => {
        const jobId = uuid().replace(/-/g, "");
        return { status: 201, body: { job_id: jobId, submission_id: uuid().replace(/-/g, ""), environment_id: 100, sha256: fakeSha256(jobId) } };
      },
    },
    {
      method: "GET",
      path: "/api/v2/report/{job_id}/summary",
      operation: "getReportSummary",
      summary: "Get the analysis summary (verdict, threat score, MITRE ATT&CK, IOCs).",
      aiTool: true,
      request: { job_id: "<job_id>" },
      respond: (ctx: MockContext): MockResult => ({ status: 200, body: summary(ctx.params.job_id) }),
    },
    {
      method: "GET",
      path: "/api/v2/search/hash",
      operation: "searchHash",
      summary: "Look up prior analyses for a file hash (query: hash).",
      aiTool: true,
      request: { hash: "44d88612fea8a8f36de82e1278abb02f" },
      respond: (ctx: MockContext): MockResult => {
        const hash = ctx.query.hash || "";
        if (!hash) return { status: 400, body: { message: "hash is required" } };
        return { status: 200, body: [summary(hash)] };
      },
    },
  ],
  events: [
    { type: "analysis.completed", summary: "A sandbox detonation finished with a verdict.", sample: () => summary(uuid().replace(/-/g, "")) },
  ],
};
