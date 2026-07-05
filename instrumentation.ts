// Next.js calls register() once on server startup. We use it to start the
// in-process schedulers (event generators + adapter heartbeat/fetch cycles) so
// simulation runs continuously without anyone opening the dashboard. Node
// runtime only (needs pg). Both are serverless-aware no-ops on Vercel, where
// /api/cron/tick drives the same runners.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/engine/scheduler");
    startScheduler();
    const { startAdapterScheduler } = await import("./lib/adapters/scheduler");
    startAdapterScheduler();
  }
}
