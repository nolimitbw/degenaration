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

// Model the ledger entries that app_private.accrue_commission_for_execution() writes,
// and assert they sum to the collected fee. Before
// degenaration-commission-allocation-balance.sql the platform account was credited the
// full fee AND the creator credited separately, so a 200 bps fee produced 270 bps of
// credits. These vectors would have caught that.
console.log("commission ledger entry model");

function ledgerEntries(allocation) {
  const entries = [];
  if (allocation.platformFeeLamports > 0n) {
    entries.push({ account: "platform", entry: "gross-fee", amount: allocation.platformFeeLamports });
  }
  if (allocation.creatorLamports > 0n) {
    entries.push({ account: "creator", entry: "creator-payable", amount: allocation.creatorLamports });
  }
  if (allocation.referralLamports > 0n) {
    entries.push({ account: "referral", entry: "referral-payable", amount: allocation.referralLamports });
  }
  const allocated = allocation.creatorLamports + allocation.referralLamports;
  if (allocated > 0n) {
    entries.push({ account: "platform", entry: "allocation-offset", amount: -allocated });
  }
  return entries;
}

for (const notionalLamports of [100n * SOL, 1n * SOL, 123456789n, 12345n, 50n]) {
  for (const sourceKind of sourceKinds) {
    for (const referralEligible of referralStates) {
      const a = fee.allocatePlatformFee({ notionalLamports, sourceKind, referralEligible });
      const entries = ledgerEntries(a);
      const label = `${notionalLamports} · ${sourceKind ?? "none"} · ref=${referralEligible}`;

      const sum = entries.reduce((total, e) => total + e.amount, 0n);
      check(`entries sum to the collected fee: ${label}`, sum === a.platformFeeLamports,
        `entries ${sum} != fee ${a.platformFeeLamports}`);

      const platformNet = entries.filter((e) => e.account === "platform")
        .reduce((total, e) => total + e.amount, 0n);
      check(`platform net equals retained: ${label}`, platformNet === a.retainedLamports,
        `platform ${platformNet} != retained ${a.retainedLamports}`);

      const creatorNet = entries.filter((e) => e.account === "creator")
        .reduce((total, e) => total + e.amount, 0n);
      check(`creator credited exactly its share: ${label}`, creatorNet === a.creatorLamports);

      const referralNet = entries.filter((e) => e.account === "referral")
        .reduce((total, e) => total + e.amount, 0n);
      check(`referral credited exactly its share: ${label}`, referralNet === a.referralLamports);

      // Reversal must return every account to zero.
      const reversed = [...entries, ...entries.map((e) => ({ ...e, amount: -e.amount }))];
      check(`full reversal nets to zero: ${label}`,
        reversed.reduce((total, e) => total + e.amount, 0n) === 0n);
    }
  }
}

// The bug this guards against, stated as an explicit vector.
console.log("regression: platform must not be credited the gross while creator is also paid");
const discordRef = fee.allocatePlatformFee({ notionalLamports: 100n * SOL, sourceKind: "discord", referralEligible: true });
const naive = discordRef.platformFeeLamports + discordRef.creatorLamports + discordRef.referralLamports;
check(
  "naive credit-everything model overstates the fee (so the offset entry is required)",
  naive > discordRef.platformFeeLamports
);
check(
  "modelled entries do not overstate",
  ledgerEntries(discordRef).reduce((t, e) => t + e.amount, 0n) === discordRef.platformFeeLamports
);

if (failures > 0) {
  console.error(`\nverify-fee-ledger: ${failures} failing invariant(s)`);
  process.exit(1);
}
console.log("\nverify-fee-ledger: all invariants hold");
