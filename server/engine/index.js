/**
 * DEGENARATION Trading Engine — receives calls from the bot,
 * rug-checks, then executes for every subscribed user.
 * DEVNET FIRST: set SOLANA_RPC_URL to devnet until fully tested.
 */
require("dotenv").config();
const http = require("http");
const { rugCheck } = require("./rugcheck");
const { buyToken } = require("./jupiter");

// In production: users/subscriptions come from Supabase, signing via Privy
// delegated session keys (trade-only, spend-capped, revocable).
const subscribers = []; // { userPubkey, groupId, settings, dailySpent, signAndSend }

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/call") { res.writeHead(404); return res.end(); }
  if (req.headers["x-bot-secret"] !== process.env.BOT_SHARED_SECRET) { res.writeHead(401); return res.end(); }

  let body = "";
  req.on("data", c => (body += c));
  req.on("end", async () => {
    res.writeHead(202); res.end();
    const call = JSON.parse(body);
    console.log(`[engine] call for ${call.mint} from group ${call.groupId}`);

    // 1) Safety gate
    const check = await rugCheck(call.mint);
    if (!check.ok) return console.log(`[engine] SKIPPED — ${check.reasons.join("; ")}`);

    // 2) Execute for each subscriber of this group, respecting their caps
    for (const u of subscribers.filter(s => s.groupId === call.groupId)) {
      if (u.dailySpent + u.settings.size > u.settings.dailyCap) {
        console.log(`[engine] ${u.userPubkey.slice(0, 6)}… daily cap hit, skipping`); continue;
      }
      try {
        const { tx } = await buyToken(call.mint, u.settings.size, u.userPubkey, u.settings.slippageBps);
        await u.signAndSend(tx); // user's delegated key signs — platform never holds keys
        u.dailySpent += u.settings.size;
        console.log(`[engine] BUY ${u.settings.size} SOL → ${call.mint} for ${u.userPubkey.slice(0, 6)}…`);
      } catch (e) {
        console.error(`[engine] buy failed for ${u.userPubkey.slice(0, 6)}…: ${e.message}`);
      }
    }
  });
});

server.listen(process.env.PORT || 8787, () => console.log("[engine] listening on :8787"));
