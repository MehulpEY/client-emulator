// Next.js calls register() once on server startup. We use it to start the
// in-process event scheduler (generators) so simulated events fire continuously
// without anyone opening the dashboard. Node runtime only (needs pg).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/engine/scheduler");
    startScheduler();
  }
}
