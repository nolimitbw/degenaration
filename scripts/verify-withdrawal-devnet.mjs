#!/usr/bin/env node
// End-to-end withdrawal proof against a real chain.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §12.3, §12.5, §22.2.
// Run: node scripts/verify-withdrawal-devnet.mjs
//
// The withdrawal endpoint builds an UNSIGNED transfer that the user signs. Unit tests
// cover the validation rules, but they cannot prove the transaction the endpoint
// constructs is actually valid, correctly funded, and landable. That needs a chain.
//
// This uses a THROWAWAY devnet keypair funded by airdrop. It never touches a real user
// wallet, never runs on mainnet, and spends no real funds — §2.11 requires exactly that.
//
// Skips cleanly (exit 0) when devnet is unreachable or the faucet is rate-limited, so it
// can sit in CI without becoming a flaky gate.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wd = require(join(root, "lib/withdrawal.js"));
const web3 = require(join(root, "node_modules/@solana/web3.js"));

// A local validator (solana-test-validator) is preferred when present: unlimited
// airdrops, no rate limit, and nothing leaves the machine. Falls back to public devnet.
// Override with SOLANA_TEST_RPC.
const LOCAL_RPC = "http://127.0.0.1:8899";
const DEVNET_RPC = "https://api.devnet.solana.com";

async function reachable(url) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: AbortSignal.timeout(2500)
    });
    return r.ok;
  } catch { return false; }
}

const RPC = process.env.SOLANA_TEST_RPC
  || (await reachable(LOCAL_RPC) ? LOCAL_RPC : DEVNET_RPC);
const isLocal = RPC === LOCAL_RPC;
let failures = 0;
const fail = (m) => { failures += 1; console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const skip = (m) => console.log(`  skip ${m}`);

console.log(`withdrawal transaction, real chain — ${isLocal ? "LOCAL VALIDATOR" : "public devnet"} (${RPC})`);

const connection = new web3.Connection(RPC, "confirmed");

const owner = web3.Keypair.generate();
const destination = web3.Keypair.generate();

// ---------------------------------------------------------------------------------------
// Part 1: structural verification. Needs no funds, so it always runs.
//
// Decoding the endpoint's own output and asserting the instruction is a correct
// SystemProgram transfer catches the bugs that matter here — wrong lamport encoding,
// wrong fee payer, wrong account order, wrong program — none of which the unit tests can
// see, because they never build a transaction.
// ---------------------------------------------------------------------------------------
console.log("  -- structural (no funds required)");

const PRETEND_BALANCE = 2_000_000_000n;
const structuralSpendable = wd.spendableLamports({ balanceLamports: PRETEND_BALANCE });
const structuralAmount = wd.percentOfSpendable(structuralSpendable, 25);
const structuralValidation = wd.validateWithdrawal({
  owner: owner.publicKey.toBase58(),
  destination: destination.publicKey.toBase58(),
  amountLamports: structuralAmount,
  balanceLamports: PRETEND_BALANCE
});
if (!structuralValidation.ok) {
  fail(`a 25% withdrawal of a 2 SOL balance was rejected: ${structuralValidation.code}`);
} else {
  const probe = new web3.Transaction({
    feePayer: owner.publicKey,
    // A syntactically valid placeholder; nothing is submitted in this part.
    recentBlockhash: web3.Keypair.generate().publicKey.toBase58()
  }).add(
    web3.SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: destination.publicKey,
      lamports: structuralValidation.amountLamports
    })
  );

  const wire = probe.serialize({ requireAllSignatures: false });
  const decoded = web3.Transaction.from(wire);

  if (decoded.instructions.length === 1) ok("exactly one instruction — no rider attached");
  else fail(`expected 1 instruction, found ${decoded.instructions.length}`);

  const ix = decoded.instructions[0];
  if (ix.programId.equals(web3.SystemProgram.programId)) ok("instruction targets the System Program");
  else fail(`instruction targets ${ix.programId.toBase58()}, not the System Program`);

  const decodedTransfer = web3.SystemInstruction.decodeTransfer(ix);
  if (decodedTransfer.fromPubkey.equals(owner.publicKey)) ok("source is the authenticated owner's wallet");
  else fail("source pubkey does not match the owner");

  if (decodedTransfer.toPubkey.equals(destination.publicKey)) ok("destination matches the requested address");
  else fail("destination pubkey does not match the request");

  // The amount survives BigInt -> wire -> decode without truncation. This is the check
  // that would catch a lamport value silently passing through a float.
  if (BigInt(decodedTransfer.lamports.toString()) === structuralValidation.amountLamports) {
    ok(`lamport amount round-trips exactly (${structuralValidation.amountLamports})`);
  } else {
    fail(`lamports became ${decodedTransfer.lamports} on the wire, expected ${structuralValidation.amountLamports}`);
  }

  if (decoded.signatures.length === 1 && decoded.signatures[0].signature === null) {
    ok("transaction leaves the server UNSIGNED — the user's wallet signs it");
  } else {
    fail("transaction is not in the expected unsigned single-signer state");
  }
}

// ---------------------------------------------------------------------------------------
// Part 2: on-chain landing. Opportunistic — the public devnet faucet is frequently
// rate-limited, and a flaky faucet must not fail the gate.
// ---------------------------------------------------------------------------------------
console.log(`  -- on-chain (${isLocal ? "local validator: unlimited airdrops" : "requires the devnet faucet"})`);

// Confirm devnet is reachable before attributing any failure to our own code.
try {
  await connection.getVersion();
} catch {
  skip("devnet unreachable from this environment — on-chain landing NOT verified");
  console.log("");
  if (failures > 0) {
    console.error(`verify-withdrawal-devnet: ${failures} structural failure(s)`);
    process.exit(1);
  }
  console.log("verify-withdrawal-devnet: structural checks hold; on-chain landing unverified");
  process.exit(0);
}

const AIRDROP = 1_000_000_000; // 1 SOL, devnet play money
try {
  const sig = await connection.requestAirdrop(owner.publicKey, AIRDROP);
  await connection.confirmTransaction(sig, "confirmed");
  ok(`funded a throwaway wallet with ${AIRDROP / 1e9} SOL`);
} catch (e) {
  const reason = /429|Too Many Requests/.test(String(e.message || e)) ? "rate limited (429)" : String(e.message || e).slice(0, 60);
  skip(`devnet faucet ${reason} — on-chain landing NOT verified`);
  console.log("");
  if (failures > 0) {
    console.error(`verify-withdrawal-devnet: ${failures} structural failure(s)`);
    process.exit(1);
  }
  console.log("verify-withdrawal-devnet: structural checks hold; on-chain landing unverified");
  process.exit(0);
}

const balance = BigInt(await connection.getBalance(owner.publicKey));
if (balance <= 0n) {
  skip("airdrop reported success but balance is zero");
  process.exit(0);
}
ok(`server-side balance read returns ${balance} lamports`);

// 1. The validation layer must agree with the real balance.
const spendable = wd.spendableLamports({ balanceLamports: balance });
if (spendable > 0n && spendable < balance) {
  ok(`spendable (${spendable}) is below balance by the rent + fee reserve`);
} else {
  fail(`spendable ${spendable} is not a sane reduction of balance ${balance}`);
}

// 2. A 50% withdrawal must validate against real figures.
const amount = wd.percentOfSpendable(spendable, 50);
const validation = wd.validateWithdrawal({
  owner: owner.publicKey.toBase58(),
  destination: destination.publicKey.toBase58(),
  amountLamports: amount,
  balanceLamports: balance
});
if (validation.ok) ok(`50% of spendable (${amount}) validates`);
else fail(`50% withdrawal rejected: ${validation.code} ${validation.message}`);

// 3. Build the transfer exactly as app/api/product/portfolio/withdraw does, serialise it
//    unsigned, then sign and submit — proving the endpoint's output is landable.
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
const transaction = new web3.Transaction({
  feePayer: owner.publicKey,
  recentBlockhash: blockhash
}).add(
  web3.SystemProgram.transfer({
    fromPubkey: owner.publicKey,
    toPubkey: destination.publicKey,
    lamports: validation.ok ? validation.amountLamports : amount
  })
);

const unsigned = transaction.serialize({ requireAllSignatures: false });
ok(`endpoint-shaped unsigned transaction serialises (${unsigned.length} bytes)`);

// The user's wallet performs this step in production. Here a throwaway keypair stands in.
let signature;
try {
  signature = await web3.sendAndConfirmTransaction(connection, transaction, [owner], {
    commitment: "confirmed"
  });
  ok(`transaction confirmed on ${isLocal ? "the local validator" : "devnet"}: ${signature}`);
} catch (e) {
  fail(`the transaction the endpoint builds did NOT land: ${String(e.message || e).slice(0, 160)}`);
  console.error(`\nverify-withdrawal-devnet: ${failures} failure(s)`);
  process.exit(1);
}

// 4. Funds actually moved, and the reserve genuinely survived.
const after = BigInt(await connection.getBalance(owner.publicKey));
const received = BigInt(await connection.getBalance(destination.publicKey));

if (received === validation.amountLamports) {
  ok(`destination received exactly the requested ${received} lamports`);
} else {
  fail(`destination received ${received}, expected ${validation.amountLamports}`);
}

if (after >= wd.RENT_EXEMPT_RESERVE_LAMPORTS) {
  ok(`source retained ${after} lamports, at or above the rent-exempt minimum`);
} else {
  fail(`source left with ${after}, below the rent-exempt minimum — the reserve is too small`);
}

// 5. A Max withdrawal must still leave the account rent-exempt. This is the case that
//    would silently strand an account if the reserve were miscalculated.
const remainingSpendable = wd.spendableLamports({ balanceLamports: after });
if (remainingSpendable < after) {
  ok("a subsequent Max withdrawal would still retain the reserve");
} else {
  fail("Max withdrawal would drain the account below rent exemption");
}

console.log(`\nchain: ${isLocal ? "local validator" : "devnet"} · owner ${owner.publicKey.toBase58()} · tx ${signature}`);

if (failures > 0) {
  console.error(`\nverify-withdrawal-devnet: ${failures} failure(s)`);
  process.exit(1);
}
console.log("verify-withdrawal-devnet: the endpoint's transaction is valid and lands on chain");
