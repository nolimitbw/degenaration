import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint } from "@/lib/server/guard";

const MIN_LIQ = 10_000, MAX_SCORE = 60;

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 40, windowMs: 60_000 });
  if (limited) return limited;

  const mint = req.nextUrl.searchParams.get("mint");
  if (!isMint(mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  const reasons: string[] = [];
  try {
    const ds = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { cache: "no-store" }).then(r => r.json()).catch(() => null);
    const pair = (ds?.pairs ?? []).sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (!pair) reasons.push("no trading pair");
    else if ((pair.liquidity?.usd || 0) < MIN_LIQ) reasons.push(`liquidity $${Math.round(pair.liquidity?.usd || 0)} < $${MIN_LIQ}`);

    const rc = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { cache: "no-store" }).then(r => r.json()).catch(() => null);
    if (rc?.score_normalised != null && rc.score_normalised > MAX_SCORE) reasons.push(`risk score ${rc.score_normalised}/100`);
    for (const risk of rc?.risks ?? []) {
      if (["danger", "warn"].includes(risk.level) && /mint|freeze|honeypot/i.test(risk.name)) reasons.push(risk.name);
    }

    const rpc = process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
    const acct = await fetch(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] })
    }).then(r => r.json()).catch(() => null);
    const info = acct?.result?.value?.data?.parsed?.info;
    if (info?.mintAuthority) reasons.push("mint authority not revoked");
    if (info?.freezeAuthority) reasons.push("freeze authority not revoked");

    return NextResponse.json({ mint, ok: reasons.length === 0, reasons });
  } catch (e: any) {
    return NextResponse.json({ mint, ok: false, reasons: ["check failed: " + e.message] }, { status: 502 });
  }
}
