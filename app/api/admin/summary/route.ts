import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { configuredPlatformFeeBps } from "@/lib/fee-model";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });

  const result = await callAdminRpc("admin_dashboard_summary", {});
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    {
      summary: {
        ...(result.data as Record<string, unknown>),
        platformFeeBps: configuredPlatformFeeBps(),
        feeWalletConfigured: Boolean(process.env.PLATFORM_FEE_ACCOUNT),
        publicFeeWallet: process.env.NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT || process.env.PLATFORM_FEE_ACCOUNT || null,
        withdrawalsConfigured: Boolean(process.env.ADMIN_WALLETS || process.env.PLATFORM_FEE_ACCOUNT)
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
