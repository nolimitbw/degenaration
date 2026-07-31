import { PublicKey } from "@solana/web3.js";
import { fetchWithTimeout } from "@/lib/server/guard";

/**
 * Resolve a usable Jupiter `feeAccount`, or decline to charge a fee.
 *
 * WHY THIS EXISTS
 * `PLATFORM_FEE_ACCOUNT` must be a TOKEN ACCOUNT, not a wallet. Jupiter's API accepts any
 * string without validating it — a bogus value builds a transaction successfully and then
 * fails on chain at execution. Verified: passing a plain wallet and passing a known-bogus
 * wallet were both accepted identically by the swap endpoint.
 *
 * So a well-meaning owner pasting their wallet address into that variable would not lose
 * fees — they would break EVERY SWAP, and the error would look like a trading bug rather
 * than a configuration mistake.
 *
 * This resolver removes that footgun:
 *   - if the configured value is already an initialised token account, use it;
 *   - if it is a wallet, derive its associated token account for the fee mint and use that
 *     when it exists on chain;
 *   - otherwise return null, and the caller omits `platformFeeBps` entirely.
 *
 * Declining to charge is always safe. Charging into an account that cannot receive is not.
 */

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

type Resolution = { feeAccount: string; reason: "configured-token-account" | "derived-ata" }
  | { feeAccount: null; reason: string };

// A swap must not pay for an RPC round trip on every request. The answer only changes when
// the owner reconfigures or the ATA is created, so a short TTL is ample.
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Resolution }>();

function associatedTokenAddress(owner: PublicKey, mint: PublicKey) {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return address;
}

async function accountInfo(address: string) {
  const rpc = process.env.SOLANA_RPC_URL || process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
  try {
    const response = await fetchWithTimeout(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [address, { encoding: "jsonParsed" }]
      }),
      cache: "no-store"
    }, 6000);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.result?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * @param feeMint the mint the fee is actually collected in. For Jupiter's default ExactIn
 *                mode that is the swap's OUTPUT mint — confirmed against the live quote
 *                endpoint, where a SOL -> BONK quote with platformFeeBps=200 reports
 *                platformFee.amount in BONK units, not lamports.
 *
 *                Do not pass the input mint. Doing so checks an account for a token the fee
 *                will never arrive in, which makes the guard below verify the wrong thing.
 */
export async function resolveFeeAccount(feeMint: string): Promise<Resolution> {
  const configured = process.env.PLATFORM_FEE_ACCOUNT?.trim();
  if (!configured) return { feeAccount: null, reason: "PLATFORM_FEE_ACCOUNT is not set" };

  const key = `${configured}:${feeMint}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const remember = (value: Resolution) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  };

  let owner: PublicKey;
  let mint: PublicKey;
  try {
    owner = new PublicKey(configured);
    mint = new PublicKey(feeMint);
  } catch {
    return remember({ feeAccount: null, reason: "PLATFORM_FEE_ACCOUNT is not a valid public key" });
  }

  const configuredInfo = await accountInfo(configured);

  // Already a token account for this mint: use it as-is.
  const parsed = configuredInfo?.data?.parsed;
  if (parsed?.type === "account" && parsed?.info?.mint === feeMint) {
    return remember({ feeAccount: configured, reason: "configured-token-account" });
  }
  if (parsed?.type === "account") {
    return remember({
      feeAccount: null,
      reason: `configured token account holds ${parsed?.info?.mint}, not the fee mint ${feeMint}`
    });
  }

  // A wallet (or an account that does not exist yet): derive its ATA for the fee mint.
  const derived = associatedTokenAddress(owner, mint).toBase58();
  const derivedInfo = await accountInfo(derived);
  if (derivedInfo) {
    return remember({ feeAccount: derived, reason: "derived-ata" });
  }

  // The ATA is not initialised. Charging into it would make the swap fail on chain, so the
  // fee is skipped until someone creates it.
  return remember({
    feeAccount: null,
    reason: `no fee token account: ${configured} is not a token account and its associated token account ${derived} does not exist for mint ${feeMint}`
  });
}

/** Test seam — the cache is process-local and would otherwise persist across suites. */
export function __clearFeeAccountCache() {
  cache.clear();
}
