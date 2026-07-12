import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout } from "@/lib/server/guard";

const cleanText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) || null : null;
const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/**
 * POST /api/ingest-call  — the Discord bot posts detected calls here.
 * Auth: header `x-bot-secret` must equal BOT_SHARED_SECRET.
 * Flow: verify the channel is an APPROVED call channel -> record the call (dedup by
 * messageId) -> the 24/7 worker then mirrors it to that group's subscribers.
 * Uses a secret-checked Supabase RPC so the Vercel deployment does not need a
 * broad service-role key for bot ingestion.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const secret = process.env.BOT_SHARED_SECRET;
  if (!secret || req.headers.get("x-bot-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const SB = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!SB || !KEY) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { channelId, channelName, mint, messageId, caller, confidence } = body ?? {};
  if (!channelId || typeof channelId !== "string") return NextResponse.json({ error: "channelId required" }, { status: 400 });
  if (!isMint(mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });

  // 1. Enrich with live price data before sending the normalized call to Supabase.
  let symbol: string | null = null, calledMcap: number | null = null, calledPrice: number | null = null, calledLiquidity: number | null = null;
  try {
    const px = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { cache: "no-store" }).then((r) => r.json());
    const pair = (px?.pairs ?? [])
      .filter((item: any) => item?.chainId === "solana" && item?.baseToken?.address === mint)
      .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (pair) {
      symbol = cleanText(pair.baseToken?.symbol, 24);
      calledMcap = positive(pair.marketCap) ?? positive(pair.fdv);
      calledPrice = positive(pair.priceUsd);
      calledLiquidity = positive(pair.liquidity?.usd);
    }
  } catch { /* enrichment is best-effort */ }

  // 2. Record the call through a security-definer RPC. The RPC verifies the bot
  // secret again, checks the channel is approved, and dedups by Discord message.
  try {
    const res = await fetchWithTimeout(`${SB}/rest/v1/rpc/bot_ingest_discord_call`, {
      method: "POST",
      headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        p_secret: secret,
        p_channel_id: channelId,
        p_channel_name: cleanText(channelName, 100),
        p_mint: mint,
        p_symbol: symbol,
        p_called_mcap: calledMcap,
        p_called_price_usd: calledPrice,
        p_called_liquidity_usd: calledLiquidity,
        p_message_id: cleanText(messageId, 64),
        p_caller: cleanText(caller, 100),
        p_confidence: cleanText(confidence, 16)
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return NextResponse.json({ error: "record failed", status: res.status }, { status: 502 });
    if (data?.ok === false) {
      return NextResponse.json({ error: data.error || "record failed" }, { status: data.status || 400 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "record failed" }, { status: 502 });
  }
}
