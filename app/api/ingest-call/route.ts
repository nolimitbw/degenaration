import { NextRequest, NextResponse } from "next/server";
import { rateLimit, fetchWithTimeout } from "@/lib/server/guard";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { isBotRequest } from "@/lib/server/bot-auth";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import {
  normalizeIngestRequest,
  selectPricePair,
  resolveDexScreenerPair,
  withResolvedMint,
  buildIngestRpcParams
} from "@/lib/discord-ingest";

const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
]);

async function verifySolanaMint(mint: string) {
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  try {
    const response = await fetchWithTimeout(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "degenaration-mint-validation",
        method: "getAccountInfo",
        params: [mint, { encoding: "jsonParsed", commitment: "confirmed" }]
      })
    }, 7_000);
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error) return { ok: false as const, unavailable: true };
    const account = payload?.result?.value;
    return {
      ok: Boolean(
        account &&
        TOKEN_PROGRAMS.has(account.owner) &&
        account.data?.parsed?.type === "mint"
      ),
      unavailable: false
    };
  } catch {
    return { ok: false as const, unavailable: true };
  }
}

/**
 * POST /api/ingest-call  — the Discord bot posts detected calls here.
 * Auth: header `x-bot-secret` must equal BOT_SHARED_SECRET.
 * Flow: verify the channel is an APPROVED call channel -> record the call (dedup by
 * messageId) -> the 24/7 worker then mirrors it to that group's subscribers.
 * Uses a secret-checked Supabase RPC so the Vercel deployment does not need a
 * broad service-role key for bot ingestion.
 *
 * The validation, confidence, content-hash and price-selection decisions live in
 * `lib/discord-ingest.js` so they can be executed by a test; this route keeps the three
 * network calls (mint validation, price fetch, bridge POST) and nothing else.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  if (!isBotRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const distributed = await distributedRateLimit(req, {
    limit: 120,
    windowSeconds: 60,
    scope: "discord:ingest-signal",
    subject: "discord-bot",
    skipLocal: true
  });
  if (distributed) return distributed;

  const secret = process.env.BOT_SHARED_SECRET!;
  const bridgeUrl = getBotBridgeUrl();
  if (!bridgeUrl) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const initialNormalized = normalizeIngestRequest(body);
  if (!initialNormalized.ok) {
    return NextResponse.json({ error: initialNormalized.error }, { status: initialNormalized.status });
  }
  let normalized = initialNormalized;

  if (normalized.mint) {
    const validation = await verifySolanaMint(normalized.mint);
    if (validation.unavailable) return NextResponse.json({ error: "mint validation temporarily unavailable" }, { status: 503 });
    if (!validation.ok && normalized.candidateType === "dexscreener_address") {
      try {
        const pairPayload = await fetchWithTimeout(
          `https://api.dexscreener.com/latest/dex/pairs/solana/${normalized.mint}`,
          { cache: "no-store" }
        ).then((response) => response.json());
        const resolved = resolveDexScreenerPair(pairPayload, normalized.mint);
        if (!resolved) return NextResponse.json({ error: "DexScreener pair does not identify one token" }, { status: 422 });
        const resolvedValidation = await verifySolanaMint(resolved);
        if (resolvedValidation.unavailable) return NextResponse.json({ error: "mint validation temporarily unavailable" }, { status: 503 });
        if (!resolvedValidation.ok) return NextResponse.json({ error: "resolved address is not a Solana token mint" }, { status: 422 });
        normalized = withResolvedMint(normalized, resolved);
      } catch {
        return NextResponse.json({ error: "pair resolution temporarily unavailable" }, { status: 503 });
      }
    } else if (!validation.ok) {
      return NextResponse.json({ error: "address is not a Solana token mint" }, { status: 422 });
    }
  }

  // 1. Enrich with live price data before sending the normalized call to Supabase.
  //    Best-effort: a call with no resolvable pair is still journaled, with a null price
  //    rather than a fabricated one.
  let price = null;
  if (normalized.mint) try {
    const payload = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${normalized.mint}`,
      { cache: "no-store" }
    ).then((r) => r.json());
    price = selectPricePair(payload, normalized.mint);
  } catch { /* enrichment is best-effort */ }

  // 2. Record the call through a security-definer RPC. The RPC verifies the bot
  // secret again, checks the channel is approved, and dedups by Discord message.
  try {
    const res = await fetchWithTimeout(bridgeUrl, {
      method: "POST",
      headers: botBridgeHeaders,
      body: JSON.stringify(buildIngestRpcParams({ normalized, price, secret }))
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
