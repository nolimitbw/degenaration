import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

const MIN_LIQ = 10_000, MAX_SCORE = 60;

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 40, windowMs: 60_000 });
  if (limited) return limited;

  const mint = req.nextUrl.searchParams.get("mint");
  if (!isMint(mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  const reasons: string[] = [];
  try {
    const ds = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { cache: "no-store" }).then(r => r.json()).catch(() => null);
    const pair = (ds?.pairs ?? []).sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    const liquidityUsd = pair ? Number(pair.liquidity?.usd) || 0 : null;
    if (!pair) reasons.push("no trading pair");
    else if ((liquidityUsd || 0) < MIN_LIQ) reasons.push(`liquidity $${Math.round(liquidityUsd || 0)} < $${MIN_LIQ}`);

    const rc = await fetchWithTimeout(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { cache: "no-store" }).then(r => r.json()).catch(() => null);
    const riskScore = Number.isFinite(Number(rc?.score_normalised)) ? Number(rc.score_normalised) : null;
    if (riskScore != null && riskScore > MAX_SCORE) reasons.push(`risk score ${riskScore}/100`);
    const providerRisks: Array<{ name: string; level: string; description: string | null }> = [];
    for (const risk of rc?.risks ?? []) {
      if (typeof risk?.name === "string") providerRisks.push({
        name: risk.name.slice(0, 120),
        level: typeof risk.level === "string" ? risk.level.slice(0, 24) : "unknown",
        description: typeof risk.description === "string" ? risk.description.slice(0, 240) : null
      });
      if (["danger", "warn"].includes(risk.level) && /mint|freeze|honeypot/i.test(risk.name)) reasons.push(risk.name);
    }

    // Prefer the reliable RPC; fail CLOSED so a failed/rate-limited lookup never yields a
    // false "PASSED" badge that could lead a user to manually buy an unverified token.
    const rpc = process.env.MAINNET_RPC || process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
    const acct = await fetchWithTimeout(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] })
    }).then(r => r.json()).catch(() => null);
    const info = acct?.result?.value?.data?.parsed?.info;
    if (!info) reasons.push("could not verify mint/freeze authority");
    else {
      if (info.mintAuthority) reasons.push("mint authority not revoked");
      if (info.freezeAuthority) reasons.push("freeze authority not revoked");
    }

    return NextResponse.json({
      mint,
      ok: reasons.length === 0,
      reasons,
      liquidityUsd,
      pairUrl: typeof pair?.url === "string" ? pair.url : null,
      riskScore,
      authoritiesVerified: Boolean(info),
      mintAuthorityRevoked: info ? !info.mintAuthority : null,
      freezeAuthorityRevoked: info ? !info.freezeAuthority : null,
      providerRisks
    });
  } catch (e: any) {
    return NextResponse.json({ mint, ok: false, reasons: ["check failed: " + sanitizeError(e)] }, { status: 502 });
  }
}
