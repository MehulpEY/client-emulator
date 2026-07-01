import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, uuid } from "../helpers";

// 2Captcha — captcha solving. The official n8n node uses the createTask /
// getTaskResult API. We return a ready token immediately (no real polling delay)
// but model the "processing → ready" lifecycle for realism.

function fakeToken(kind: string): string {
  const r = rng(kind + uuid());
  const len = kind.includes("Turnstile") ? 380 : 1200;
  let s = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let i = 0; i < len; i++) s += chars[Math.floor(r() * chars.length)];
  return s;
}

export const twocaptcha: ToolDef = {
  id: "2captcha",
  name: "2Captcha",
  vendor: "2Captcha",
  category: "automation",
  crafted: true,
  aiTool: true,
  summary:
    "2Captcha bypasses captchas natively — Cloudflare Turnstile, reCAPTCHA v2/v3/Enterprise and image-to-text. Handles task creation, polling and token extraction, returning a ready-to-use token.",
  tags: ["captcha", "turnstile", "recaptcha", "automation", "ai-tool"],
  auth: { type: "none" },
  docsUrl: "https://2captcha.com/api-docs",
  defaultLatencyMs: 600,
  endpoints: [
    {
      method: "POST",
      path: "/createTask",
      operation: "createTask",
      summary: "Create a captcha-solving task. Returns a taskId to poll with getTaskResult.",
      aiTool: true,
      request: {
        clientKey: "<api_key>",
        task: { type: "TurnstileTaskProxyless", websiteURL: "https://example.com", websiteKey: "0x4AAAAA..." },
      },
      respond: (ctx: MockContext): MockResult => {
        const type = ctx.body?.task?.type;
        if (!type) return { status: 200, body: { errorId: 2, errorCode: "ERROR_TASK_ABSENT", errorDescription: "Task property is required." } };
        const r = rng("2c:" + uuid());
        return { status: 200, body: { errorId: 0, taskId: int(r, 1e10, 9e10) } };
      },
    },
    {
      method: "POST",
      path: "/getTaskResult",
      operation: "getTaskResult",
      summary: "Poll a task. Returns status 'processing' or 'ready' with the solved token.",
      aiTool: true,
      request: { clientKey: "<api_key>", taskId: 73045902001 },
      respond: (ctx: MockContext): MockResult => {
        if (!ctx.body?.taskId) return { status: 200, body: { errorId: 16, errorCode: "ERROR_NO_SUCH_CAPCHA_ID", errorDescription: "You've provided incorrect captcha ID." } };
        // The emulator returns ready on the first poll for fast simulation.
        const kind = "Turnstile";
        return {
          status: 200,
          body: {
            errorId: 0,
            status: "ready",
            solution: { token: fakeToken(kind), gRecaptchaResponse: fakeToken("reCAPTCHA") },
            cost: "0.00145",
            ip: "1.2.3.4",
            createTime: Math.floor(Date.now() / 1000) - 8,
            endTime: Math.floor(Date.now() / 1000),
            solveCount: 1,
          },
        };
      },
    },
    {
      method: "POST",
      path: "/getBalance",
      operation: "getBalance",
      summary: "Return the account balance for the client key.",
      request: { clientKey: "<api_key>" },
      respond: (): MockResult => ({ status: 200, body: { errorId: 0, balance: 9.8421 } }),
    },
  ],
  events: [
    { type: "task.solved", summary: "A captcha task was solved and a token is ready.", sample: () => ({ taskId: int(rng(uuid()), 1e10, 9e10), status: "ready", solution: { token: fakeToken("Turnstile") }, cost: "0.00145" }) },
  ],
};
