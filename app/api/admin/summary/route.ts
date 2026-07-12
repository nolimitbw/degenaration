import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const result = await callAdminRpc("admin_dashboard_summary", {});
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    {
      summary: {
        ...(result.data as Record<string, unknown>),
        platformFeeBps: process.env.PLATFORM_FEE_ACCOUNT ? 200 : 0,
        feeWalletConfigured: Boolean(process.env.PLATFORM_FEE_ACCOUNT || process.env.NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT),
        publicFeeWallet: process.env.NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT || null,
        withdrawalsConfigured: Boolean(process.env.ADMIN_WALLETS || process.env.PLATFORM_FEE_ACCOUNT || process.env.NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT)
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
