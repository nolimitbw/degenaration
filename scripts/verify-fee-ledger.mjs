#!/usr/bin/env node
// Deterministic fee/reward vectors: every allocation must balance exactly.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §4.4, §13.5, §22.1
// Run: node scripts/verify-fee-ledger.mjs

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fee = require("../lib/fee-model.js");

const SOL = 1000000000n;
let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Every combination of source kind and referral eligibility, across notionals that
// exercise exact division, flooring remainders, and dust.
const notionals = [
  100n * SOL,
  1n * SOL,
  SOL / 2n,
  123456789n,
  12345n,
  50n,
  1n,
  0n
];
const sourceKinds = [undefined, "discord", "kol"];
const referralStates = [false, true];

console.log("fee ledger invariants");

for (const notionalLamports of notionals) {
  for (const sourceKind of sourceKinds) {
    for (const referralEligible of referralStates) {
      const a = fee.allocatePlatformFee({ notionalLamports, sourceKind, referralEligible });
      const label = `${notionalLamports} lamports · ${sourceKind ?? "none"} · ref=${referralEligible}`;
      const sum = a.creatorLamports + a.referralLamports + a.retainedLamports;

      check(
        `balances: ${label}`,
        sum === a.platformFeeLamports,
        `debits ${sum} != credits ${a.platformFeeLamports}`
      );
      check(
        `no negative components: ${label}`,
        a.creatorLamports >= 0n && a.referralLamports >= 0n && a.retainedLamports >= 0n
      );
      check(
        `fee never exceeds notional: ${label}`,
        a.platformFeeLamports <= notionalLamports
      );
    }
  }
}

// The user is charged one flat rate regardless of who gets paid out of it (§13.2).
console.log("user-facing rate is invariant to internal allocation");
const base = fee.allocatePlatformFee({ notionalLamports: 100n * SOL });
for (const sourceKind of sourceKinds) {
  for (const referralEligible of referralStates) {
    const a = fee.allocatePlatformFee({ notionalLamports: 100n * SOL, sourceKind, referralEligible });
    check(
      `flat 200 bps · ${sourceKind ?? "none"} · ref=${referralEligible}`,
      a.platformFeeLamports === base.platformFeeLamports
    );
  }
}

// Documented spec examples (§13.2).
console.log("spec worked examples");
const discord = fee.allocatePlatformFee({ notionalLamports: 100n * SOL, sourceKind: "discord" });
check("discord retained is 130 bps", discord.retainedLamports === fee.bpsOf(100n * SOL, 130));
const kol = fee.allocatePlatformFee({ notionalLamports: 100n * SOL, sourceKind: "kol" });
check("kol retained is 180 bps", kol.retainedLamports === fee.bpsOf(100n * SOL, 180));
const ref = fee.allocatePlatformFee({ notionalLamports: 100n * SOL, referralEligible: true });
check("referral is 10% of collected fee", ref.referralLamports === ref.platformFeeLamports / 10n);

if (failures > 0) {
  console.error(`\nverify-fee-ledger: ${failures} failing invariant(s)`);
  process.exit(1);
}
console.log("\nverify-fee-ledger: all invariants hold");
