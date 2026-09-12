#!/usr/bin/env bash
set -euo pipefail

systemctl is-active --quiet degenaration-worker.service
systemctl is-active --quiet degenaration-discord.service

WORKER_HEALTH="$(curl --fail --silent --show-error http://127.0.0.1:10000/health)"
DISCORD_HEALTH="$(curl --fail --silent --show-error http://127.0.0.1:10001/health)"

node -e '
const worker = JSON.parse(process.argv[1]);
const bot = JSON.parse(process.argv[2]);
if (worker.status !== "ok") throw new Error("worker health is not ok");
if (bot.status !== "ok" || bot.discord?.ready !== true) throw new Error("Discord Gateway is not ready");
if (!bot.source_bridge?.approvedRefresh?.lastSuccessAt || bot.source_bridge.approvedRefresh.lastError) {
  throw new Error("approved-channel refresh is not healthy");
}
console.log(JSON.stringify({
  worker: { status: worker.status, mode: worker.mode, network: worker.network, uptimeSeconds: worker.uptimeSeconds },
  discord: { status: bot.status, version: bot.version, guilds: bot.discord.guilds, approvedChannels: bot.source_bridge.approvedChannels }
}, null, 2));
' "${WORKER_HEALTH}" "${DISCORD_HEALTH}"

test "$(pgrep -u degenaration -fc 'node index.js')" -eq 1 || { echo "Expected exactly one Discord listener" >&2; exit 1; }
test "$(pgrep -u degenaration -fc 'node worker.js')" -eq 1 || { echo "Expected exactly one execution worker" >&2; exit 1; }
journalctl -u degenaration-discord.service --since '-15 minutes' --no-pager | grep -F 'listener.heartbeat' | tail -n 1
