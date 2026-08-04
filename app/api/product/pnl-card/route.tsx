import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";
import { UUID_RE } from "@/lib/server/product";
import { fetchWithTimeout, isMint } from "@/lib/server/guard";
// The card's financial decisions live in one tested module rather than inline in this
// handler. server/test/run.js is synchronous by design, so logic buried in an async route
// that needs a session, two RPCs and a price provider could never be asserted — which is
// how a closed trade came to print its average entry in a different unit from an open one.
import { closedTradeCard, openPositionCard, perUnitSol, shareTarget } from "@/lib/pnl-card";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRUSTED_QUOTES = new Set([SOL_MINT, USDC_MINT]);
const CARD_WIDTH = 1600;
const CARD_HEIGHT = 900;

type Position = {
  id: string;
  mint: string;
  botName?: string | null;
  status: string;
  quantityBaseUnits: string;
  costLamports: string;
  realizedPnlLamports: string;
  feesLamports: string;
  opened_at: string;
  closed_at?: string | null;
};

async function rpc(method: string, params: unknown[]) {
  const endpoint = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store"
  }, 7_000);
  if (!response.ok) throw new Error("Solana RPC unavailable");
  const data = await response.json();
  if (data.error) throw new Error("Solana RPC rejected mint");
  return data.result;
}

function decimalToScaled(value: unknown, scale = 18) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const scaled = `${whole}${fraction.padEnd(scale, "0").slice(0, scale)}`.replace(/^0+(?=\d)/, "");
  try {
    return BigInt(scaled || "0");
  } catch {
    return null;
  }
}

async function marketValue(position: Position) {
  if (!isMint(position.mint) || !/^\d+$/.test(position.quantityBaseUnits)) {
    throw new Error("Invalid reconciled position");
  }
  const [supply, tokenMarket, solMarket] = await Promise.all([
    rpc("getTokenSupply", [position.mint]),
    fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${position.mint}`, { cache: "no-store" }, 7_000).then((response) => response.json()),
    fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`, { cache: "no-store" }, 7_000).then((response) => response.json())
  ]);
  const best = (pairs: any[]) => [...(pairs || [])].sort(
    (a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0)
  )[0];
  const tokenPair = best((tokenMarket?.pairs || []).filter((pair: any) =>
    pair.baseToken?.address === position.mint
    && TRUSTED_QUOTES.has(pair.quoteToken?.address)
  ));
  const solPair = best((solMarket?.pairs || []).filter((pair: any) =>
    pair.baseToken?.address === SOL_MINT
    && pair.quoteToken?.address === USDC_MINT
  ));
  const tokenPriceUsd = decimalToScaled(tokenPair?.priceUsd);
  const solPriceUsd = decimalToScaled(solPair?.priceUsd);
  const decimals = Number(supply?.value?.decimals);
  const quantityBaseUnits = BigInt(position.quantityBaseUnits);
  if (
    tokenPriceUsd == null ||
    tokenPriceUsd <= BigInt(0) ||
    solPriceUsd == null ||
    solPriceUsd <= BigInt(0) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    quantityBaseUnits <= BigInt(0)
  ) {
    throw new Error("Fresh market evidence unavailable");
  }
  const tokenScale = BigInt(10) ** BigInt(decimals);
  const currentValueLamports = quantityBaseUnits * tokenPriceUsd * BigInt(1_000_000_000)
    / (tokenScale * solPriceUsd);
  return {
    symbol: tokenPair?.baseToken?.symbol || position.mint.slice(0, 6),
    currentValueLamports,
    currentPriceSol: Number(tokenPriceUsd) / Number(solPriceUsd),
    quantityBaseUnits,
    tokenScale
  };
}

function durationLabel(start: string, end?: string | null) {
  const elapsed = Math.max(0, new Date(end || Date.now()).getTime() - new Date(start).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function sol(lamports: bigint | number | string | null | undefined, digits = 3) {
  try {
    return `${(Number(BigInt(lamports ?? "0")) / 1e9).toFixed(digits)} SOL`;
  } catch {
    return "0.000 SOL";
  }
}

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 20, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const type = req.nextUrl.searchParams.get("type");
  const period = ["7d", "30d", "3m"].includes(req.nextUrl.searchParams.get("period") || "") ? req.nextUrl.searchParams.get("period")! : "30d";
  if (type !== "portfolio" && type !== "position") return NextResponse.json({ error: "invalid card type" }, { status: 400 });

  const portfolioResult = await callPrivyRpc<any>("app_user_portfolio_summary", {
    p_privy_user_id: user.privyUserId,
    p_period: period
  });
  if (!portfolioResult.ok) return NextResponse.json({ error: portfolioResult.error }, { status: portfolioResult.status });

  const affiliateResult = await callPrivyRpc<any>("app_user_affiliate_summary", {
    p_privy_user_id: user.privyUserId,
    p_scope: "all"
  });
  const referralCode = affiliateResult.ok ? affiliateResult.data?.referralCode : null;
  // Derived together from one value: a QR resolving anywhere other than the visible link is
  // indistinguishable from a phishing card once the image leaves the product.
  const { url: shareUrl, label: shareLabel } = shareTarget(referralCode, process.env.SITE_URL);
  const qr = await QRCode.toDataURL(shareUrl, { margin: 0, width: 220, color: { dark: "#17191b", light: "#f3f0eb" } });

  let card: {
    variant: "winner" | "loser" | "portfolio";
    title: string;
    pair: string;
    pnlPercent: number;
    pnlLamports: bigint;
    entryPrice?: string;
    currentPrice?: string;
    duration: string;
    source: string;
    context: string;
  };
  let recordSubjectType: "position" | "portfolio-snapshot";
  let recordSubjectId: string;

  if (type === "portfolio") {
    const performance = portfolioResult.data?.performance;
    if (!performance) return NextResponse.json({ error: "A reconciled portfolio snapshot is required before a share card can be generated." }, { status: 409 });
    const pnlLamports = BigInt(performance.netPnlLamports || 0);
    const capitalLamports = BigInt(performance.metrics?.averageCapitalLamports || performance.volumeLamports || 0);
    const pnlPercent = capitalLamports > BigInt(0) ? Number(pnlLamports * BigInt(10000) / capitalLamports) / 100 : 0;
    card = {
      variant: "portfolio",
      title: "Portfolio performance",
      pair: period.toUpperCase(),
      pnlPercent,
      pnlLamports,
      duration: period.toUpperCase(),
      source: "Reconciled bot portfolio",
      context: `${performance.sampleSize || 0} completed executions · net of recorded fees`
    };
    recordSubjectType = "portfolio-snapshot";
    recordSubjectId = user.privyUserId;
  } else {
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid position id" }, { status: 400 });
    const position = (portfolioResult.data?.positions || []).find((item: Position) => item.id === id) as Position | undefined;
    if (!position) return NextResponse.json({ error: "position not found" }, { status: 404 });
    const heldBaseUnits = /^\d+$/.test(position.quantityBaseUnits || "")
      ? BigInt(position.quantityBaseUnits)
      : BigInt(0);
    const closed = position.status === "closed" || Boolean(position.closed_at) || heldBaseUnits === BigInt(0);

    // A closed position holds no tokens, so marketValue() cannot price it — and until
    // app_private.position_exits existed, nothing linked a position to the executions that
    // closed it, so a closed trade could not produce a card at all. It can now: average entry
    // is cost/quantity and average exit is proceeds/quantity, both division of recorded
    // integers. No price feed is consulted and nothing is inferred.
    if (closed) {
      const exitResult = await callPrivyRpc<any>("app_user_position_exits", {
        p_privy_user_id: user.privyUserId,
        p_position_id: position.id
      });
      if (!exitResult.ok) {
        return NextResponse.json({ error: exitResult.error }, { status: exitResult.status });
      }
      // Refuse rather than guess when the worker never reported what a sale realized. The
      // two reasons are distinguished inside closedTradeCard: an exit whose proceeds were
      // never recorded is something to wait for, a position with no exit at all is not.
      const aggregate = exitResult.data?.ok ? exitResult.data?.aggregate : null;

      // Token decimals, so the price is per WHOLE TOKEN and matches what the open-position
      // card prints for the same trade. Quantities are stored in base units; without
      // 10^decimals the same "AVERAGE ENTRY" label read 2.0000 SOL while the position was
      // open and 2.0000e-9 SOL once it closed.
      //
      // getTokenSupply is mint metadata, not market data: it states how many decimals the
      // mint declares. No price is consulted and nothing is inferred, so this keeps the
      // property that a closed trade is priced entirely from recorded integers. If it is
      // unavailable the price fields are omitted rather than printed at the wrong scale —
      // the PnL figures are unit-independent and still correct.
      let tokenScale: bigint | null = null;
      try {
        const supply = await rpc("getTokenSupply", [position.mint]);
        const decimals = Number(supply?.value?.decimals);
        if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 18) {
          tokenScale = BigInt(10) ** BigInt(decimals);
        }
      } catch {
        tokenScale = null;
      }

      const decided = closedTradeCard(aggregate, tokenScale);
      if (!decided.ok) {
        return NextResponse.json({ error: decided.error }, { status: decided.status });
      }

      card = {
        variant: decided.variant,
        title: decided.title,
        pair: `${position.mint.slice(0, 6)} / SOL`,
        pnlPercent: decided.pnlPercent,
        pnlLamports: decided.pnlLamports,
        entryPrice: decided.averageEntrySol === null
          ? undefined
          : `${decided.averageEntrySol.toPrecision(5)} SOL`,
        currentPrice: decided.averageExitSol === null
          ? undefined
          : `${decided.averageExitSol.toPrecision(5)} SOL`,
        duration: durationLabel(position.opened_at, position.closed_at),
        source: position.botName || "DegenAration bot",
        context: decided.context
      };
    } else {
      let live;
      try {
        live = await marketValue(position);
      } catch {
        return NextResponse.json({ error: "Fresh token and SOL market evidence is unavailable, so an open-position PnL card was not generated." }, { status: 503 });
      }
      const decided = openPositionCard({
        currentValueLamports: live.currentValueLamports,
        realizedPnlLamports: position.realizedPnlLamports,
        costLamports: position.costLamports,
        feesLamports: position.feesLamports
      });
      // Same helper the closed branch uses, so the two cannot disagree about the unit again.
      const averageEntry = perUnitSol(position.costLamports, live.quantityBaseUnits, live.tokenScale);
      card = {
        variant: decided.variant,
        title: decided.title,
        pair: `${live.symbol} / SOL`,
        pnlPercent: decided.pnlPercent,
        pnlLamports: decided.pnlLamports,
        entryPrice: averageEntry === null ? undefined : `${averageEntry.toPrecision(5)} SOL`,
        currentPrice: `${live.currentPriceSol.toPrecision(5)} SOL`,
        duration: durationLabel(position.opened_at, position.closed_at),
        source: position.botName || "DegenAration bot",
        context: `${position.status} position · net of recorded fees`
      };
    }
    recordSubjectType = "position";
    recordSubjectId = position.id;
  }

  const positive = card.pnlLamports >= BigInt(0);
  const accent = card.variant === "portfolio" ? "#c29463" : positive ? "#55b987" : "#d56f6f";
  const generatedAt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date()) + " UTC";
  const recorded = await callPrivyRpc("app_user_record_pnl_card", {
    p_privy_user_id: user.privyUserId,
    p_card_type: card.variant,
    p_subject_type: recordSubjectType,
    p_subject_id: recordSubjectId,
    p_snapshot: {
      pair: card.pair,
      pnlPercent: card.pnlPercent,
      pnlLamports: card.pnlLamports.toString(),
      entryPrice: card.entryPrice || null,
      currentPrice: card.currentPrice || null,
      duration: card.duration,
      source: card.source,
      context: card.context,
      period,
      generatedAt
    },
    p_referral_code: referralCode,
    p_render_version: 1
  });
  if (!recorded.ok) {
    return NextResponse.json(
      { error: "The verified PnL snapshot could not be recorded." },
      { status: 503 }
    );
  }

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "#0d0e0f", color: "#f3f0eb", fontFamily: "sans-serif" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", opacity: 0.35, backgroundImage: "linear-gradient(#2b2a28 1px, transparent 1px), linear-gradient(90deg, #2b2a28 1px, transparent 1px)", backgroundSize: "54px 54px" }} />
      <div style={{ position: "absolute", left: -180, top: -240, width: 640, height: 640, display: "flex", border: `1px solid ${accent}`, transform: "rotate(28deg)", opacity: 0.18 }} />
      <div style={{ position: "absolute", left: -80, top: -90, width: 430, height: 430, display: "flex", border: "1px solid #c29463", transform: "rotate(28deg)", opacity: 0.14 }} />
      <div style={{ position: "absolute", right: 70, top: 70, bottom: 70, width: 2, display: "flex", background: accent, opacity: 0.65 }} />

      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "72px 84px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 34, borderBottom: "1px solid #383632" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <BrandMark />
            <div style={{ display: "flex", fontSize: 31, fontWeight: 750 }}>Degen<span style={{ color: "#c29463" }}>A</span>ration</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#9d9992", fontSize: 16 }}>
            <span style={{ width: 9, height: 9, display: "flex", borderRadius: 99, background: accent }} />
            VERIFIED LEDGER SNAPSHOT
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", paddingTop: 54 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", color: accent, fontSize: 17, textTransform: "uppercase", letterSpacing: 3 }}>{card.title}</div>
            <div style={{ display: "flex", marginTop: 14, fontSize: 42, fontWeight: 720 }}>{card.pair}</div>
            <div style={{ display: "flex", marginTop: 38, color: accent, fontSize: 106, lineHeight: 1, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{card.pnlPercent >= 0 ? "+" : ""}{card.pnlPercent.toFixed(2)}%</div>
            <div style={{ display: "flex", marginTop: 18, fontSize: 28, color: "#cbc6bd" }}>{card.pnlLamports >= BigInt(0) ? "+" : ""}{sol(card.pnlLamports)}</div>

            <div style={{ display: "flex", gap: 14, marginTop: 50 }}>
              {card.entryPrice && <CardDatum label="AVERAGE ENTRY" value={card.entryPrice} />}
              {card.currentPrice && <CardDatum label="CURRENT / EXIT" value={card.currentPrice} />}
              <CardDatum label="DURATION" value={card.duration} />
              <CardDatum label="SOURCE" value={card.source} />
            </div>
          </div>

          <div style={{ width: 300, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "flex-end" }}>
            <div style={{ width: 220, height: 220, display: "flex", padding: 10, background: "#f3f0eb" }}><img src={qr} width="200" height="200" alt="" /></div>
            <div style={{ display: "flex", marginTop: 16, color: "#9d9992", fontSize: 14 }}>SCAN VERIFIED SHARE URL</div>
            <div style={{ display: "flex", marginTop: 8, color: "#cbc6bd", fontSize: 13 }}>{shareLabel}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 30, borderTop: "1px solid #383632" }}>
          <div style={{ display: "flex", flexDirection: "column", color: "#9d9992", fontSize: 15 }}>
            <span>{card.context}</span>
            <span style={{ marginTop: 8 }}>Generated {generatedAt} · Trading is high risk. Not financial advice.</span>
          </div>
          <div style={{ display: "flex", color: "#cbc6bd", fontSize: 16 }}>{shareLabel}</div>
        </div>
      </div>
    </div>,
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      headers: {
        "Content-Disposition": `inline; filename=degenaration-${card.variant}-pnl.png`,
        "Cache-Control": "private, no-store",
        "X-DegenAration-Share-Url": shareUrl
      }
    }
  );
}

function BrandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" width="54" height="54">
      <path d="M19 6h13l10 10v16L32 42H19V31h9l3-3v-8l-3-3h-9V6Z" fill="#f3f0eb" />
      <path d="M6 10h8v8H6v-8Zm3 13h13v8H9v-8Zm-3 13h8v8H6v-8Z" fill="#c29463" />
      <path d="M22 20h5l2 2v4l-2 2h-5v-8Z" fill="#0d0e0f" />
    </svg>
  );
}

function CardDatum({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 175, display: "flex", flexDirection: "column", padding: "16px 18px", border: "1px solid #383632", background: "#151617" }}>
      <span style={{ color: "#9d9992", fontSize: 12 }}>{label}</span>
      <span style={{ marginTop: 9, color: "#f3f0eb", fontSize: 18 }}>{value}</span>
    </div>
  );
}
