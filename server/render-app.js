/**
 * Free Render runtime for the DegenAration web app and Discord REST recovery scanner.
 *
 * The canonical Vercel team is quota-paused, and Render cannot establish Discord's outbound
 * Gateway WebSocket from this instance. Running the normal Next server plus one bounded REST
 * scan per minute keeps approved call channels ingesting without a paid worker or a function
 * that idles for most of every minute.
 */
const next = require("next");

const port = Number(process.env.PORT || 10000);
const hostname = "0.0.0.0";
// Discord can return a global retry window longer than one minute. Starting another scan
// before that window expires keeps the bot permanently rate limited, so the free recovery
// poll deliberately leaves two minutes between bounded passes.
const scanIntervalMs = Math.max(120_000, Number(process.env.DISCORD_REST_SCAN_INTERVAL_MS || 120_000));
// Performance sampling is independent from Discord history recovery. Keeping it on its own
// cadence means a Discord rate-limit or inaccessible channel cannot also freeze the winning
// tracker. Five minutes is frequent enough for visible position milestones while remaining a
// bounded, free-tier-friendly workload.
const performanceIntervalMs = Math.max(300_000, Number(process.env.CALL_PERFORMANCE_INTERVAL_MS || 300_000));
// Entries are also triggered by live ingestion, but exits, settlement and reconciliation need
// an independent clock. The route itself owns every signing, network and exit-path guard and
// returns watch-only when the deployment is not deliberately authorized to trade.
const executionIntervalMs = Math.max(60_000, Number(process.env.EXECUTION_TICK_INTERVAL_MS || 60_000));
const secret = process.env.BOT_SHARED_SECRET?.trim();

async function runAuthenticatedRoute(path, label, timeoutMs) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { "x-bot-secret": secret },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await response.json().catch(() => null);
    console.log(`[render-app] ${label} ${response.status}`, JSON.stringify({
      ok: body?.ok === true,
      scanned: body?.scanned ?? null,
      unpriced: body?.unpriced ?? null,
      channels: Array.isArray(body?.channels) ? body.channels.length : null,
      skipped: body?.skipped ?? null,
      failedChannels: Array.isArray(body?.channels) ? body.channels.filter(channel => channel?.error).length : null,
      // Render logs are the operator-only diagnostic surface. Include the bounded execution
      // result here so a 200 watch-only/refusal response cannot be mistaken for a healthy
      // signing pass. None of these fields are returned through public product endpoints.
      mode: body?.mode || null,
      traded: body?.traded ?? null,
      reason: body?.reason || null,
      missing: Array.isArray(body?.missing) ? body.missing : null,
      problems: Array.isArray(body?.problems) ? body.problems : null,
      ticks: body?.ticks ?? null,
      counts: body?.counts || null,
      errors: body?.errors || null,
      error: body?.error || null
    }));
  } catch (error) {
    console.error(`[render-app] ${label} failed:`, error?.message || error);
  }
}

async function main() {
  const app = next({ dev: false, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = require("node:http").createServer((req, res) => handle(req, res));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });
  console.log(`[render-app] listening on ${hostname}:${port}`);

  if (!secret) {
    console.error("[render-app] BOT_SHARED_SECRET is missing; Discord REST recovery is disabled");
    return;
  }

  const scan = () => runAuthenticatedRoute(
    "/api/cron/discord-backfill?live=1",
    "Discord REST scan",
    55_000
  );
  const samplePerformance = () => runAuthenticatedRoute(
    "/api/cron/call-performance",
    "call performance scan",
    240_000
  );
  const runExecutionTick = () => runAuthenticatedRoute(
    "/api/worker/tick",
    "execution tick",
    55_000
  );

  setTimeout(scan, 5_000);
  setInterval(scan, scanIntervalMs);
  setTimeout(samplePerformance, 15_000);
  setInterval(samplePerformance, performanceIntervalMs);
  setTimeout(runExecutionTick, 25_000);
  setInterval(runExecutionTick, executionIntervalMs);
}

main().catch((error) => {
  console.error("[render-app] fatal:", error);
  process.exitCode = 1;
});
