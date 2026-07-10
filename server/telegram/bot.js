/**
 * DEGENARATION Telegram bot — notifications + quick commands.
 * Users link their Telegram in Settings (generate a code), then receive alert/trade notifications.
 * Run: node server/telegram/bot.js  (set TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY)
 */
require("dotenv").config();
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SB = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function send(chatId, text) {
  return fetch(`${API}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
  }).then(r => r.json());
}

async function verifyLinkCode(code) {
  if (!SB || !SB_KEY) return null;
  const res = await fetch(`${SB.replace(/\/+$/,"")}/rest/v1/telegram_links?code=eq.${encodeURIComponent(code)}&select=user_id,used`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  }).then(r => r.json());
  if (!res?.length) return null;
  const row = res[0];
  if (row.used) return null;
  return row.user_id;
}

async function markLinkUsed(code, chatId) {
  if (!SB || !SB_KEY) return;
  await fetch(`${SB.replace(/\/+$/,"")}/rest/v1/telegram_links?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    body: JSON.stringify({ used: true, chat_id: String(chatId) })
  });
}

async function fetchPrice(mint) {
  const ds = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`).then(r => r.json()).catch(() => null);
  const pair = ds?.pairs?.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  if (!pair) return null;
  const p = parseFloat(pair.priceUsd);
  return {
    price: p, symbol: pair.baseToken?.symbol, name: pair.baseToken?.name,
    mcap: pair.fdv || pair.marketCap, liq: pair.liquidity?.usd,
    url: `https://dexscreener.com/solana/${mint}`
  };
}

let offset = 0;
async function poll() {
  try {
    const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`).then(r => r.json());
    for (const u of res.result || []) {
      offset = u.update_id + 1;
      const msg = u.message; if (!msg?.text) continue;
      const [cmd, arg] = msg.text.trim().split(/\s+/);

      if (cmd === "/start") {
        await send(msg.chat.id, "🟢 *Degenaration* connected. You'll get alerts and trade notifications here.\nUse /link <code> to link your account (generate a code in Settings).");
      }

      else if (cmd === "/link") {
        if (!arg) { await send(msg.chat.id, "Usage: /link <code from Settings>"); continue; }
        if (!SB || !SB_KEY) { await send(msg.chat.id, "Linking is not configured."); continue; }
        const userId = await verifyLinkCode(arg);
        if (!userId) { await send(msg.chat.id, "Invalid or already-used code. Generate a new one in Settings."); continue; }
        await markLinkUsed(arg, msg.chat.id);
        await send(msg.chat.id, "Account linked. You'll receive trade alerts here.");
      }

      else if (cmd === "/price") {
        if (!arg) { await send(msg.chat.id, "Usage: /price <mint>"); continue; }
        const p = await fetchPrice(arg);
        if (!p) { await send(msg.chat.id, `No price data for \`${arg}\`. Check the address.`); continue; }
        const fmt = p.price < 0.0001 ? p.price.toExponential(4) : p.price < 1 ? p.price.toFixed(6) : p.price.toFixed(4);
        await send(msg.chat.id, [
          `*${p.symbol || p.name || arg}*`,
          `Price: \`$${fmt}\``,
          p.mcap ? `Market Cap: \`$${Number(p.mcap).toLocaleString()}\`` : null,
          p.liq ? `Liquidity: \`$${Number(p.liq).toLocaleString()}\`` : null,
          `[View on DexScreener](${p.url})`
        ].filter(Boolean).join("\n"));
      }

      else {
        await send(msg.chat.id, "Commands: /start /link <code> /price <mint>");
      }
    }
  } catch (e) { console.error("[tg]", e.message); }
  setTimeout(poll, 500);
}
if (!TOKEN) console.log("[tg] set TELEGRAM_BOT_TOKEN to run the bot"); else { console.log("[tg] bot polling"); poll(); }
module.exports = { send };
