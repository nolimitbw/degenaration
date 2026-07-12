import { NextResponse } from "next/server";

const PLATFORM_FEE_BPS = 200;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const feeWalletConfigured = Boolean(process.env.PLATFORM_FEE_ACCOUNT);
  return NextResponse.json(
    {
      platformFeeBps: feeWalletConfigured ? PLATFORM_FEE_BPS : 0,
      feeWalletConfigured,
      feeLabel: feeWalletConfigured ? `${PLATFORM_FEE_BPS / 100}%` : "Off"
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
