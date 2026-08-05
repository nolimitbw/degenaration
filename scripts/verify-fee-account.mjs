/**
 * Which fee token account is missing, and what its address is — read-only.
 *
 * WHY. E-4 says the platform collects 0 bps because `PLATFORM_FEE_ACCOUNT` names a wallet
 * whose associated token account does not exist. That was established by reading
 * lib/server/fee-account.ts and by observing three unsigned mainnet builds come back with
 * `platformFeeBps: 0`. Both are inference. Neither says WHICH account to create, and "create
 * the right fee account" is not an instruction anyone can act on without that address.
 *
 * This computes it. Give it the fee wallet's public address and it reports, per fee mint,
 * whether a usable fee account already exists and — when it does not — the exact associated
 * token account address that has to be initialised.
 *
 *   node scripts/verify-fee-account.mjs <FEE_WALLET_PUBLIC_ADDRESS>
 *   PLATFORM_FEE_ACCOUNT=<address> node scripts/verify-fee-account.mjs
 *
 * READ-ONLY. `getAccountInfo` only; it never signs, never sends, and creates nothing. Creating
 * the account is a signed transaction and is deliberately not done here.
 *
 * The derivation mirrors lib/server/fee-account.ts exactly — same program ids, same seed
 * order. If they ever disagree, this reports an address the product will not use, which is
 * worse than reporting nothing, so `verify:fee-account-parity` in server/test asserts they
 * agree on a fixed vector.
 */
import { createHash } from "node:crypto";

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const WALLET = (process.argv[2] || process.env.PLATFORM_FEE_ACCOUNT || "").trim();

/**
 * The mints a fee can actually arrive in.
 *
 * Jupiter's default ExactIn mode takes the platform fee from the swap's OUTPUT mint, so a SELL
 * (token -> SOL) pays in wSOL and a BUY (SOL -> token) pays in that token. wSOL therefore
 * covers every exit and is the one account that matters most; USDC covers the common
 * stable-quoted pair. A buy into an arbitrary memecoin needs that coin's ATA, which cannot be
 * pre-created for a token nobody has called yet — that is a real limitation of collecting the
 * fee on the output side, and it is stated here rather than discovered later.
 */
const FEE_MINTS = [
  { symbol: "wSOL", mint: "So11111111111111111111111111111111111111112", why: "every sell leg" },
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", why: "stable-quoted pairs" }
];

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// ── base58 and the PDA derivation, without pulling in @solana/web3.js ───────────────────────
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`not base58: ${str}`);
    num = num * 58n + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) { bytes.unshift(Number(num & 255n)); num >>= 8n; }
  for (const ch of str) { if (ch === "1") bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}
function b58encode(bytes) {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = "";
  while (num > 0n) { out = ALPHABET[Number(num % 58n)] + out; num /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}

/** Ed25519 curve check — a PDA must NOT be on the curve, which is what the bump search finds. */
function isOnCurve(bytes) {
  // Decompression test over the Ed25519 field. A point is on the curve when
  // x^2 = (y^2 - 1) / (d*y^2 + 1) has a square root.
  const P = (1n << 255n) - 19n;
  const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
  const pow = (b, e) => { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
  let y = 0n;
  for (let i = 31; i >= 0; i -= 1) y = (y << 8n) | BigInt(bytes[i] & (i === 31 ? 0x7f : 0xff));
  if (y >= P) return false;
  const y2 = y * y % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  const uv3 = u * pow(v, 3n) % P;
  const uv7 = u * pow(v, 7n) % P;
  let x = uv3 * pow(uv7, (P - 5n) / 8n) % P;
  const vxx = v * x % P * x % P;
  if (vxx === u) return true;
  if (vxx === (P - u) % P) return true;
  return false;
}

function findAta(owner, mint) {
  const seeds = [b58decode(owner), b58decode(TOKEN_PROGRAM), b58decode(mint)];
  const program = b58decode(ATA_PROGRAM);
  const marker = Buffer.from("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = createHash("sha256");
    for (const seed of seeds) hash.update(Buffer.from(seed));
    hash.update(Buffer.from([bump]));
    hash.update(Buffer.from(program));
    hash.update(marker);
    const candidate = hash.digest();
    if (!isOnCurve(candidate)) return { address: b58encode(candidate), bump };
  }
  throw new Error("no off-curve address found");
}

async function accountInfo(address) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "getAccountInfo",
      params: [address, { encoding: "jsonParsed", commitment: "confirmed" }]
    })
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result?.value ?? null;
}

if (!WALLET) {
  console.log(JSON.stringify({
    verifier: "fee-account",
    status: "NO INPUT",
    usage: "node scripts/verify-fee-account.mjs <FEE_WALLET_PUBLIC_ADDRESS>",
    note: "PLATFORM_FEE_ACCOUNT is not set in this shell. Only a PUBLIC address is needed — " +
          "never a private key, and this script cannot use one."
  }, null, 2));
  process.exit(0);
}

const configured = await accountInfo(WALLET).catch((error) => { throw new Error(`RPC: ${error.message}`); });
const configuredKind = configured?.data?.parsed?.type ?? (configured ? "non-token account" : "does not exist");

const report = [];
for (const { symbol, mint, why } of FEE_MINTS) {
  // Same order the product uses: an already-correct token account wins, otherwise the ATA.
  if (configured?.data?.parsed?.type === "account") {
    const held = configured.data.parsed.info?.mint;
    report.push({
      symbol, mint, why,
      usable: held === mint,
      feeAccount: held === mint ? WALLET : null,
      reason: held === mint
        ? "the configured value IS a token account for this mint"
        : `the configured token account holds ${held}, not this mint`
    });
    continue;
  }
  const { address } = findAta(WALLET, mint);
  const info = await accountInfo(address);
  report.push({
    symbol, mint, why,
    usable: Boolean(info),
    feeAccount: info ? address : null,
    associatedTokenAccount: address,
    reason: info
      ? "the associated token account exists and will receive the fee"
      : "the associated token account DOES NOT EXIST — the fee is skipped, so 0 bps is collected"
  });
}

const missing = report.filter((r) => !r.usable);

console.log(JSON.stringify({
  verifier: "fee-account",
  cluster: RPC,
  feeWallet: WALLET,
  configuredAccountKind: configuredKind,
  perMint: report,
  collectsFeeToday: missing.length === 0,
  ...(missing.length
    ? {
        action: "Create the associated token account for each address below. It is a one-time " +
          "`createAssociatedTokenAccount` per mint, costs about 0.00204 SOL of rent each, and " +
          "moves no user funds. Until then the resolver correctly skips the fee rather than " +
          "charging into an uninitialised account and making every swap fail on chain.",
        create: missing.map((r) => ({ symbol: r.symbol, mint: r.mint, associatedTokenAccount: r.associatedTokenAccount }))
      }
    : {}),
  limitation:
    "Jupiter takes the fee from the OUTPUT mint in ExactIn mode, so a BUY into an arbitrary " +
    "memecoin needs that coin's fee account, which cannot be pre-created for a token nobody " +
    "has called yet. wSOL covers every SELL leg, which is where realised value is.",
  safety: { signed: false, broadcast: false, accountsCreated: 0, rpcMethodsUsed: ["getAccountInfo"] }
}, null, 2));
