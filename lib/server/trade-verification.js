'use strict';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

/**
 * Program id of a parsed instruction. jsonParsed supplies `programId` directly; the
 * index form is handled too so a legacy or partially-parsed response still resolves.
 */
function programIdOf(instruction, keys) {
  if (!instruction) return null;
  if (typeof instruction.programId === 'string') return instruction.programId;
  if (Number.isInteger(instruction.programIdIndex) && Array.isArray(keys)) {
    const key = keys[instruction.programIdIndex];
    return key ? key.pubkey : null;
  }
  return null;
}

function keyInfo(entry) {
  if (typeof entry === 'string') return { pubkey: entry, signer: false };
  return { pubkey: String(entry?.pubkey || ''), signer: entry?.signer === true };
}

function rawAmount(entry) {
  try { return BigInt(entry?.uiTokenAmount?.amount || '0'); } catch { return 0n; }
}

function ownerBalance(rows, owner, mint) {
  let amount = 0n;
  let decimals = null;
  for (const row of rows || []) {
    if (row?.owner !== owner || row?.mint !== mint) continue;
    amount += rawAmount(row);
    if (Number.isInteger(row?.uiTokenAmount?.decimals)) decimals = row.uiTokenAmount.decimals;
  }
  return { amount, decimals };
}

function indexedBalance(rows, index) {
  const row = (rows || []).find((item) => item?.accountIndex === index);
  return row ? { amount: rawAmount(row), decimals: row.uiTokenAmount?.decimals, mint: row.mint } : null;
}

function analyzeSwapTransaction(transaction, expected) {
  const meta = transaction?.meta;
  const message = transaction?.transaction?.message;
  if (!meta || !message || meta.err) return { ok: false, error: 'transaction failed or is unavailable' };

  const signatures = transaction.transaction.signatures || [];
  if (!signatures.includes(expected.signature)) return { ok: false, error: 'signature does not match transaction' };

  const keys = (message.accountKeys || []).map(keyInfo);
  const signerIndex = keys.findIndex((key) => key.pubkey === expected.userPubkey && key.signer);
  if (signerIndex < 0) return { ok: false, error: 'wallet did not sign this transaction' };

  // Proof that Jupiter actually ran must come from the INSTRUCTIONS, not the logs.
  // logMessages is program-writable text: any program can emit
  // "Program JUP6Lkb... invoke [1]" with msg!, so a log-only check can be satisfied by a
  // transaction that never touched Jupiter. Combined with a self-transfer to move a token
  // balance, that was enough to pass every other check here.
  //
  // The blast radius was small - public.trades is RLS-scoped to the caller's own rows,
  // commissions accrue from app_private.trade_executions instead, and the PnL card reads
  // the portfolio RPCs - so this fabricated only the caller's own legacy trade history.
  // A function called verifySwapTransaction should still not accept a string as proof.
  //
  // jsonParsed encoding gives each instruction a programId, so an actual invocation can be
  // required. Inner instructions count: Jupiter is frequently reached through a CPI.
  const instructions = Array.isArray(message.instructions) ? message.instructions : [];
  const innerGroups = Array.isArray(meta.innerInstructions) ? meta.innerInstructions : [];
  const invokesJupiter =
    instructions.some((ix) => programIdOf(ix) === JUPITER_V6) ||
    innerGroups.some((group) => (group?.instructions || []).some((ix) => programIdOf(ix) === JUPITER_V6));
  if (!invokesJupiter) {
    return { ok: false, error: 'transaction is not a Jupiter swap' };
  }

  const before = ownerBalance(meta.preTokenBalances, expected.userPubkey, expected.mint);
  const after = ownerBalance(meta.postTokenBalances, expected.userPubkey, expected.mint);
  const decimals = after.decimals ?? before.decimals;
  const tokenDelta = after.amount - before.amount;
  if (!Number.isInteger(decimals) || tokenDelta === 0n) return { ok: false, error: 'token balance did not change' };

  const side = tokenDelta > 0n ? 'buy' : 'sell';
  if (side !== expected.side) return { ok: false, error: 'trade side does not match balance changes' };

  let feeSol = 0;
  if (expected.feeAccount) {
    const feeIndex = keys.findIndex((key) => key.pubkey === expected.feeAccount);
    if (feeIndex < 0) return { ok: false, error: 'configured fee account is missing from transaction' };
    const feeBefore = indexedBalance(meta.preTokenBalances, feeIndex);
    const feeAfter = indexedBalance(meta.postTokenBalances, feeIndex);
    const feeMint = feeAfter?.mint || feeBefore?.mint;
    if (feeMint !== SOL_MINT) return { ok: false, error: 'fee account must receive wrapped SOL' };
    const feeRaw = (feeAfter?.amount || 0n) - (feeBefore?.amount || 0n);
    if (feeRaw < 0n) return { ok: false, error: 'fee account balance decreased' };
    feeSol = Number(feeRaw) / 1e9;
  }

  return {
    ok: true,
    side,
    feeSol,
    tokenAmount: Number(tokenDelta < 0n ? -tokenDelta : tokenDelta) / (10 ** decimals)
  };
}

async function verifySwapTransaction({ rpcUrl, signature, userPubkey, mint, side, feeAccount }) {
  if (!SIGNATURE.test(String(signature || ''))) return { ok: false, error: 'invalid transaction signature' };
  const delays = [0, 500, 1000, 1500];
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    let response;
    try {
      response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
        }),
        signal: AbortSignal.timeout(8000)
      }).then((result) => result.json());
    } catch {
      if (delay === delays[delays.length - 1]) return { ok: false, error: 'transaction verification failed' };
      continue;
    }
    if (response?.error) return { ok: false, error: 'transaction verification failed' };
    if (response?.result) return analyzeSwapTransaction(response.result, { signature, userPubkey, mint, side, feeAccount });
  }
  return { ok: false, error: 'transaction is not confirmed yet' };
}

module.exports = { SOL_MINT, analyzeSwapTransaction, verifySwapTransaction };
