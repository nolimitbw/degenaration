/**
 * The on-chain SOL balance of a wallet, and the spendable figure derived from it.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED
 *
 * `app_user_withdrawable_state` returns lockedLamports, inFlightIntents and
 * pendingWithdrawalLamports. It does NOT return a balance and cannot: it is a Postgres
 * function and the balance lives on Solana. Spendable is on-chain balance minus those holds
 * minus the rent and fee reserve, and that arithmetic lives in lib/withdrawal.js.
 *
 * The bot readiness route read `state.data?.spendableLamports` off that RPC — a key it has
 * never returned. It was therefore always undefined, so the capital check always answered
 * "Your available balance could not be read", and RUN was blocked for every user at every
 * balance. The builder showed a real wallet balance two inches away on the same screen,
 * because the builder reads the chain and the readiness route did not.
 *
 * One reader, used by both money surfaces, is what stops that happening again.
 */
import { spendableLamports } from "@/lib/withdrawal";

const FALLBACKS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];

function endpoints(): string[] {
  const preferred = [process.env.SOLANA_RPC_URL, process.env.MAINNET_RPC].filter(Boolean) as string[];
  return [...new Set([...preferred, ...FALLBACKS])];
}

/**
 * getBalance is the one call every public RPC answers, so it gets failover. Returns null when
 * no provider would answer — never 0, which would read as an empty wallet.
 */
export async function walletBalanceLamports(address: string): Promise<bigint | null> {
  for (const url of endpoints()) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] })
      });
      if (!response.ok) continue;
      const data = await response.json();
      const value = data?.result?.value;
      if (value == null || !Number.isFinite(Number(value))) continue;
      return BigInt(Math.floor(Number(value)));
    } catch {
      // Try the next provider. An exhausted list returns null below.
    }
  }
  return null;
}

/** The holds the database knows about. Null when the bridge could not answer. */
export function holdsFrom(
  state: { ok: boolean; data?: { lockedLamports?: string; pendingWithdrawalLamports?: string } | null }
): { locked: bigint; pending: bigint } | null {
  if (!state.ok) return null;
  try {
    return {
      locked: BigInt(String(state.data?.lockedLamports ?? "0")),
      pending: BigInt(String(state.data?.pendingWithdrawalLamports ?? "0"))
    };
  } catch {
    return null;
  }
}

/**
 * Spendable lamports as a decimal string, or undefined when it genuinely cannot be determined.
 * Undefined is the honest answer only when the CHAIN could not be read or the holds could not
 * be fetched — not merely because a key was missing from a response.
 */
export async function spendableFor(
  address: string,
  state: { ok: boolean; data?: { lockedLamports?: string; pendingWithdrawalLamports?: string } | null }
): Promise<string | undefined> {
  const holds = holdsFrom(state);
  if (!holds) return undefined;
  const balance = await walletBalanceLamports(address);
  if (balance == null) return undefined;
  return spendableLamports({
    balanceLamports: balance,
    lockedLamports: holds.locked,
    pendingWithdrawalLamports: holds.pending
  }).toString();
}
