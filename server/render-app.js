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
const secret = process.env.BOT_SHARED_SECRET?.trim();

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

  const scan = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/cron/discord-backfill?live=1`, {
        headers: { "x-bot-secret": secret },
        signal: AbortSignal.timeout(55_000)
      });
      const body = await response.json().catch(() => null);
      console.log(`[render-app] Discord REST scan ${response.status}`, JSON.stringify({
        ok: body?.ok === true,
        channels: Array.isArray(body?.channels) ? body.channels.length : null,
        skipped: body?.skipped ?? null,
        failedChannels: Array.isArray(body?.channels) ? body.channels.filter(channel => channel?.error).length : null,
        error: body?.error || null
      }));
    } catch (error) {
      console.error("[render-app] Discord REST scan failed:", error?.message || error);
    }
  };

  setTimeout(scan, 5_000);
  setInterval(scan, scanIntervalMs);
}

main().catch((error) => {
  console.error("[render-app] fatal:", error);
  process.exitCode = 1;
});
