import { fetchWithTimeout } from "./guard";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const FALLBACK_RPC = "https://solana-rpc.publicnode.com";
const cache = new Map<string, { decimals: number; at: number }>();
const TTL_MS = 10 * 60_000;

export async function getMintDecimals(mint: string): Promise<number> {
  if (mint === SOL_MINT) return 9;
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.decimals;

  const rpc = process.env.MAINNET_RPC || process.env.NEXT_PUBLIC_MAINNET_RPC || FALLBACK_RPC;
  const response = await fetchWithTimeout(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [mint, { encoding: "jsonParsed" }]
    })
  }).then((r) => r.json());

  const decimals = Number(response?.result?.value?.data?.parsed?.info?.decimals);
  const safeDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : 6;
  cache.set(mint, { decimals: safeDecimals, at: Date.now() });
  return safeDecimals;
}
