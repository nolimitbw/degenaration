import { NextRequest } from "next/server";
import { rpcResponse } from "@/lib/server/product";
import { callAppBridge } from "@/lib/server/app-bridge";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 90, windowSeconds: 60 });
  if (limited) return limited;
  return rpcResponse(await callAppBridge("app_scanner_status", {}));
}
