import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createHash } from "node:crypto";
import { rateLimit, isMint, fetchWithTimeout } from "@/lib/server/guard";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { isBotRequest, isDiscordSnowflake } from "@/lib/server/bot-auth";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";

const cleanText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) || null : null;
const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const EVENT_TYPES = new Set(["create", "edit", "delete"]);

function confidenceBps(value: unknown) {
  if (value === "slash-command") return 10_000;
  if (value === "message-edit") return 8_000;
  if (value === "message") return 9_000;
  return 7_500;
}

/**
 * Best-effort price snapshot. Never on the request's critical path: a call is
 * journaled first and enriched afterwards, so a slow or down price feed can delay
 * the numbers but never the call itself.
 */
async function quoteMint(mint: string) {
  try {
    const px = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { cache: "no-store" }).then((r) => r.json());
    const pair = (px?.pairs ?? [])
      .filter((item: any) => item?.chainId === "solana" && item?.baseToken?.address === mint)
      .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (!pair) return null;
    return {
      symbol: cleanText(pair.baseToken?.symbol, 24),
      calledMcap: positive(pair.marketCap) ?? positive(pair.fdv),
      calledPrice: positive(pair.priceUsd),
      calledLiquidity: positive(pair.liquidity?.usd)
    };
  } catch {
    return null;
  }
}

// How long the trade push waits for the entry-price snapshot. Past this the call is
// dispatched regardless — an unpriced call still gets executed, just without the
// optional liquidity/mcap filters being able to judge it.
const ENRICH_HEAD_START_MS = 1_500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function enrichCall(bridgeUrl: string, secret: string, callId: string, mint: string) {
  const quote = await quoteMint(mint);
  if (!quote) return;
  try {
    await fetchWithTimeout(bridgeUrl, {
      method: "POST",
      headers: botBridgeHeaders,
      body: JSON.stringify({
        operation: "enrich_call",
        p_secret: secret,
        p_call_id: callId,
        p_symbol: quote.symbol,
        p_called_mcap: quote.calledMcap,
        p_called_price_usd: quote.calledPrice,
        p_called_liquidity_usd: quote.calledLiquidity
      })
    }, 8_000);
  } catch {
    // The performance scanner backfills pricing on its next pass.
  }
}

/**
 * Tell the 24/7 worker to execute this call now. Without it the worker still picks the
 * call up on its next poll, so a failure here costs latency, not the trade.
 */
async function dispatchToWorker(callId: string) {
  const url = process.env.WORKER_DISPATCH_URL;
  const secret = process.env.BOT_SHARED_SECRET;
  if (!url || !secret) return;
  try {
    await fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": secret },
      body: JSON.stringify({ callId })
    }, 5_000);
  } catch {
    // Poll backstop covers it.
  }
}

/**
 * POST /api/ingest-call  — the Discord bot posts detected calls here.
 * Auth: header `x-bot-secret` must equal BOT_SHARED_SECRET.
 *
 * JOURNAL FIRST. Every mint posted in an approved channel is a call and is recorded
 * the moment it arrives — there is no pre-trade scanning, mint verification, or price
 * lookup standing between the Discord message and the journal row. The record goes in,
 * the bot gets its 200, and price enrichment runs afterwards via `after()`.
 *
 * What stays on the critical path is integrity, not judgement: the shared bot secret,
 * Discord snowflake shape, base58 mint shape, rate limits, and the RPC's own approval
 * and dedup checks.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 600, windowMs: 60_000 });
  if (limited) return limited;

  if (!isBotRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const distributed = await distributedRateLimit(req, {
    limit: 600,
    windowSeconds: 60,
    scope: "discord:ingest-signal",
    subject: "discord-bot",
    skipLocal: true
  });
  if (distributed) return distributed;

  const secret = process.env.BOT_SHARED_SECRET!;
  const bridgeUrl = getBotBridgeUrl();
  if (!bridgeUrl) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { channelId, channelName, mint, messageId, caller, confidence } = body ?? {};
  const eventType = EVENT_TYPES.has(body?.eventType) ? body.eventType : "create";
  const eventVersion = cleanText(body?.eventVersion, 64) || (eventType === "create" ? "original" : null);
  const editedAt = body?.editedAt && Number.isFinite(Date.parse(body.editedAt)) ? new Date(body.editedAt).toISOString() : null;
  if (!isDiscordSnowflake(channelId) || !isDiscordSnowflake(messageId)) {
    return NextResponse.json({ error: "invalid Discord channel or message" }, { status: 400 });
  }
  if (!eventVersion) return NextResponse.json({ error: "event version required" }, { status: 400 });
  if (eventType !== "delete" && !isMint(mint)) {
    return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  }

  const contentHash = createHash("sha256")
    .update([channelId, messageId, eventVersion, eventType, mint || ""].join(":"))
    .digest("hex");

  // 1. Record the call through a security-definer RPC. The RPC verifies the bot
  // secret again, checks the channel is approved, and dedups by Discord event.
  let data: any;
  try {
    const res = await fetchWithTimeout(bridgeUrl, {
      method: "POST",
      headers: botBridgeHeaders,
      body: JSON.stringify({
        operation: "ingest_signal_v2",
        p_secret: secret,
        p_channel_id: channelId,
        p_channel_name: cleanText(channelName, 100),
        p_mint: mint,
        p_symbol: null,
        p_called_mcap: null,
        p_called_price_usd: null,
        p_called_liquidity_usd: null,
        p_message_id: cleanText(messageId, 64),
        p_caller: cleanText(caller, 100),
        p_confidence: cleanText(confidence, 32),
        p_event_type: eventType,
        p_event_version: eventVersion,
        p_edited_at: editedAt,
        p_parser_version: "discord-v3",
        p_confidence_bps: confidenceBps(confidence),
        p_content_hash: contentHash
      })
    });
    data = await res.json().catch(() => null);
    if (!res.ok) return NextResponse.json({ error: "record failed", status: res.status }, { status: 502 });
    if (data?.ok === false) {
      return NextResponse.json({ error: data.error || "record failed" }, { status: data.status || 400 });
    }
  } catch {
    return NextResponse.json({ error: "record failed" }, { status: 502 });
  }

  // 2. Enrich the recorded row, then push the call to the worker — both after the
  // response is sent, so the bot is never held up.
  const callId = typeof data?.id === "string" ? data.id : null;
  if (callId && data?.accepted && eventType !== "delete") {
    after(async () => {
      // Subscriber filters (min liquidity, max mcap) read these numbers, so give the
      // snapshot a short head start — but never let a slow feed hold up the trade.
      await Promise.race([enrichCall(bridgeUrl, secret, callId, mint), sleep(ENRICH_HEAD_START_MS)]);
      await dispatchToWorker(callId);
    });
  }

  return NextResponse.json(data);
}
