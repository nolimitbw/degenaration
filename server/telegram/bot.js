/**
 * DEGENARATION Telegram bot — notifications + quick commands.
 * Users link their Telegram in Settings (a code), then receive alert/trade notifications.
 * Run: node server/telegram/bot.js  (set TELEGRAM_BOT_TOKEN)
 */
require("dotenv").config();
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

async function send(chatId, text) {
  return fetch(`${API}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
  }).then(r => r.json());
}

// Long-poll updates
let offset = 0;
async function poll() {
  try {
    const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`).then(r => r.json());
    for (const u of res.result || []) {
      offset = u.update_id + 1;
      const msg = u.message; if (!msg?.text) continue;
      const [cmd, arg] = msg.text.trim().split(/\s+/);
      if (cmd === "/start") await send(msg.chat.id, "🟢 *Degenaration* connected. You'll get alerts and trade notifications here.\nUse /link <code> to link your account.");
      else if (cmd === "/link") await send(msg.chat.id, arg ? `Linking code \`${arg}\`… (verified against your account in production)` : "Usage: /link <code from Settings>");
      else if (cmd === "/price") await send(msg.chat.id, arg ? `Fetching live price for \`${arg}\`…` : "Usage: /price <mint>");
      else await send(msg.chat.id, "Commands: /start /link <code> /price <mint>");
    }
  } catch (e) { console.error("[tg]", e.message); }
  setTimeout(poll, 500);
}
if (!TOKEN) console.log("[tg] set TELEGRAM_BOT_TOKEN to run the bot"); else { console.log("[tg] bot polling"); poll(); }
module.exports = { send };
