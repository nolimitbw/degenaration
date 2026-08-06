import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { configuredPlatformFeeBps } from "@/lib/fee-model";
import { feeAccountReadiness } from "@/lib/server/fee-account";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });

  const result = await callAdminRpc("admin_dashboard_summary", {});
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Which fee token account has to exist, and whether it does. Computed server-side because
  // it needs PLATFORM_FEE_ACCOUNT, and reported only to an authenticated owner — so the exact
  // account to create is visible without pulling the production environment anywhere.
  const feeReadiness = await feeAccountReadiness();
  return NextResponse.json(
    {
      summary: {
        ...(result.data as Record<string, unknown>),
        platformFeeBps: configuredPlatformFeeBps(),
        feeWalletConfigured: Boolean(process.env.PLATFORM_FEE_ACCOUNT),
        publicFeeWallet: process.env.NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT || process.env.PLATFORM_FEE_ACCOUNT || null,
        withdrawalsConfigured: Boolean(process.env.ADMIN_WALLETS || process.env.PLATFORM_FEE_ACCOUNT),
        // `feeWalletConfigured` only says the variable is non-empty, which is how a 2.00%
        // preview coexisted with a 0 bps charge for weeks. This says whether the fee can
        // actually be collected, and names the account that has to exist when it cannot.
        feeAccount: feeReadiness
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
