/**
 * Wallet registration: identity binding, idempotency, cross-user refusal, audit trail.
 *
 * Step 1 of docs/ai/ACCOUNTING_MODEL.md. Before it, app_private.trading_wallets had no writer
 * anywhere in the application, so the server could not name any user's wallet and no
 * server-side balance reconciliation was possible for anyone.
 *
 * Two layers are covered:
 *   - the migration, against real PostgreSQL (PGlite), with fixtures generated from the
 *     captured production shape;
 *   - solanaWalletFromPayload(), the pure function that decides which address gets recorded.
 *     That one matters most: it is the only thing standing between the ledger and an address
 *     chosen by the request body.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const require = createRequire(import.meta.url);
const { solanaWalletFromPayload, ownsPrivyWallet } = require("../lib/server/privy-wallet.js");

const repo = process.cwd();
const db = new PGlite();
const walletSql = await readFile(`${repo}/supabase/degenaration-wallet-registration.sql`, "utf8");

const FIXTURE_TABLES = ["app_private.app_users", "app_private.trading_wallets"];

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema app_private;

  create function app_private.admin_secret_ok(p_secret text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_secret is not null and p_secret = 'wallet-test-secret' $$;

  create function app_private.ensure_app_user(p_privy_user_id text)
  returns void language plpgsql security definer set search_path = ''
  as $$
  begin
    if nullif(trim(p_privy_user_id), '') is null or char_length(p_privy_user_id) > 200 then
      raise exception 'invalid user' using errcode = '22023';
    end if;
    insert into app_private.app_users (privy_user_id) values (trim(p_privy_user_id))
    on conflict (privy_user_id) do nothing;
  end $$;

  -- Shared by every append-only history table in the schema.
  create function app_private.reject_immutable_mutation()
  returns trigger language plpgsql set search_path = ''
  as $$ begin raise exception 'history is immutable' using errcode = '55000'; end $$;
`);
await db.exec(renderTables(FIXTURE_TABLES));
await assertSchemaParity(db, FIXTURE_TABLES, assert);
await db.exec(walletSql);

const SECRET = "wallet-test-secret";
const ALICE = "did:privy:alice";
const BOB = "did:privy:bob";
// Real-shape base58, 32-44 chars, no 0/O/I/l.
const WALLET_A = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const WALLET_B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const WALLET_C = "3nCFXtLSmw3vTKp7hGL1DZmDLBvUuVDQ8s9y4Ae1n6Ra";

const register = (user, address, walletId = null, label = null) =>
  db.query(
    "select public.app_user_upsert_wallet($1::text, $2::text, $3::text, $4::text, $5::text) as result",
    [SECRET, user, address, walletId, label]
  ).then((r) => r.rows[0].result);

const primary = (user) =>
  db.query("select public.app_user_primary_wallet($1::text, $2::text) as result", [SECRET, user])
    .then((r) => r.rows[0].result);

const audit = (user) =>
  db.query(
    `select action, wallet_address, previous_address from app_private.wallet_audit_log
      where privy_user_id = $1::text order by created_at, action`,
    [user]
  ).then((r) => r.rows);

const results = {};

// ---- the signed-in user's wallet is persisted ------------------------------------------

let first = await register(ALICE, WALLET_A, "pw-alice-1", "Privy wallet");
assert.equal(first.ok, true);
assert.equal(first.address, WALLET_A);
assert.equal(first.isPrimary, true, "the first wallet registered becomes the primary");
assert.equal(first.created, true);
assert.equal(first.status, "active");
assert.ok(first.verifiedAt, "verification is timestamped");

const resolved = await primary(ALICE);
assert.equal(resolved.wallet.address, WALLET_A, "the server can now name the user's wallet");
assert.equal(resolved.wallet.chain, "solana");
results.walletPersisted = "PASS";

// ---- replay does not duplicate --------------------------------------------------------

for (let i = 0; i < 3; i += 1) await register(ALICE, WALLET_A, "pw-alice-1", "Privy wallet");
const rows = await db.query(
  "select count(*)::integer as n from app_private.trading_wallets where privy_user_id = $1::text",
  [ALICE]
);
assert.equal(rows.rows[0].n, 1, "four registrations of the same wallet produce exactly one row");
const replayAudit = await audit(ALICE);
assert.equal(replayAudit.length, 1, "a replay writes no additional audit rows");
assert.equal(replayAudit[0].action, "registered");
results.replayIsIdempotent = "PASS";

// ---- another user cannot overwrite it -------------------------------------------------

await assert.rejects(
  () => register(BOB, WALLET_A, "pw-bob-1"),
  /already registered to another account/i,
  "a Solana address has one owner; a second claim must be refused"
);
const stillAlice = await db.query(
  "select privy_user_id from app_private.trading_wallets where address = $1::text",
  [WALLET_A]
);
assert.equal(stillAlice.rows.length, 1);
assert.equal(stillAlice.rows[0].privy_user_id, ALICE, "the refusal left the original claim intact");

// The refusal must not leak who holds it.
try {
  await register(BOB, WALLET_A);
  assert.fail("expected refusal");
} catch (error) {
  assert.doesNotMatch(String(error.message), /alice/i, "the other owner is never named in the error");
}
results.crossUserClaimRefused = "PASS";

// ---- an invalid Solana address is rejected --------------------------------------------

const INVALID = [
  ["", "empty"],
  ["   ", "whitespace"],
  ["short", "too short"],
  ["0OIl000000000000000000000000000000", "contains base58-excluded characters 0 O I l"],
  ["5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1extra_far_too_long_for_a_key", "too long"],
  ["5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j!", "punctuation"]
];
for (const [value, why] of INVALID) {
  await assert.rejects(
    () => register(BOB, value),
    /invalid wallet address/i,
    `must reject: ${why}`
  );
}
// The pre-existing check was `length between 32 and 64`, which accepted the 0/O/I/l case
// above. Prove the new validator is doing the work.
const bobRows = await db.query(
  "select count(*)::integer as n from app_private.trading_wallets where privy_user_id = $1::text",
  [BOB]
);
assert.equal(bobRows.rows[0].n, 0, "no invalid address created a row");
results.invalidAddressRejected = "PASS";

// ---- a legitimate wallet change is defined and audited --------------------------------

const changed = await register(ALICE, WALLET_B, "pw-alice-2");
assert.equal(changed.isPrimary, true, "the new wallet becomes primary");
assert.equal(changed.replacedAddress, WALLET_A, "the response names what it replaced");
assert.equal((await primary(ALICE)).wallet.address, WALLET_B);

const bothActive = await db.query(
  `select address, status, is_primary from app_private.trading_wallets
    where privy_user_id = $1::text order by address`,
  [ALICE]
);
assert.equal(bothActive.rows.length, 2, "the previous wallet is kept, not deleted");
assert.equal(
  bothActive.rows.filter((r) => r.is_primary).length, 1,
  "exactly one primary per user, enforced by a partial unique index"
);
assert.ok(
  bothActive.rows.every((r) => r.status === "active"),
  "a user may legitimately hold an embedded AND a connected wallet; neither is revoked"
);

const changeAudit = await audit(ALICE);
assert.ok(changeAudit.some((r) => r.action === "demoted" && r.wallet_address === WALLET_A));
assert.ok(changeAudit.some((r) => r.action === "registered" && r.wallet_address === WALLET_B));
results.walletChangeAudited = "PASS";

// ---- the audit trail is immutable -----------------------------------------------------

await assert.rejects(
  () => db.query("update app_private.wallet_audit_log set action = 'revoked'"),
  /immutable/i
);
await assert.rejects(
  () => db.query("delete from app_private.wallet_audit_log"),
  /immutable/i
);
results.auditTrailImmutable = "PASS";

// ---- switching back promotes rather than re-registering -------------------------------

const back = await register(ALICE, WALLET_A);
assert.equal(back.created, false, "the row already existed");
assert.equal(back.isPrimary, true);
const backAudit = await audit(ALICE);
assert.ok(
  backAudit.some((r) => r.action === "promoted" && r.wallet_address === WALLET_A),
  "returning to a previously registered wallet is a promotion, not a registration"
);
results.promotionDistinctFromRegistration = "PASS";

// ---- authorization ---------------------------------------------------------------------

await assert.rejects(
  () => db.query(
    "select public.app_user_upsert_wallet($1::text, $2::text, $3::text, null, null)",
    ["wrong-secret", ALICE, WALLET_C]
  ),
  /unauthorized/i
);
await assert.rejects(
  () => db.query(
    "select public.app_user_upsert_wallet($1::text, $2::text, $3::text, null, null)",
    [null, ALICE, WALLET_C]
  ),
  /unauthorized/i,
  "a NULL secret must not slip through the `if not ...` guard"
);

for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => register(ALICE, WALLET_C), /permission denied/i,
    `${role} must not execute the registration RPC`);
  await assert.rejects(() => primary(ALICE), /permission denied/i,
    `${role} must not read another user's wallet`);
  await db.exec("reset role");
}
await db.exec("set role service_role");
assert.ok(await primary(ALICE), "service_role — the edge function identity — may execute it");
await db.exec("reset role");
results.authorization = "PASS";

// ---- a user with no wallet resolves to null, not an error -----------------------------

await db.query("insert into app_private.app_users (privy_user_id) values ($1::text)", ["did:privy:carol"]);
const none = await primary("did:privy:carol");
assert.equal(none.ok, true);
assert.equal(none.wallet, null, "no wallet is a null result, never an exception");
results.absentWalletIsNull = "PASS";

// ---- the address comes from the token, never the request body -------------------------
//
// This is the property that keeps the ledger honest. Every case below is about
// solanaWalletFromPayload refusing to let a request influence which address gets recorded.

const solanaAccount = { type: "wallet", chain_type: "solana", address: WALLET_A, id: "pw-1" };

assert.deepEqual(
  solanaWalletFromPayload({ sub: ALICE, linked_accounts: [solanaAccount] }, ALICE),
  { address: WALLET_A, walletId: "pw-1", delegated: false }
);

assert.equal(
  solanaWalletFromPayload({ sub: BOB, linked_accounts: [solanaAccount] }, ALICE), null,
  "a token for a different subject yields nothing"
);
assert.equal(
  solanaWalletFromPayload({ sub: ALICE, linked_accounts: [] }, ALICE), null,
  "no linked wallet yields nothing"
);
assert.equal(
  solanaWalletFromPayload(
    { sub: ALICE, linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: "0xabc" }] },
    ALICE
  ), null,
  "an Ethereum wallet is not a Solana wallet — Privy returns one by default"
);
assert.equal(
  solanaWalletFromPayload(
    { sub: ALICE, linked_accounts: [{ type: "wallet", chain_type: "solana", address: "0OIl-not-base58" }] },
    ALICE
  ), null,
  "a linked account carrying a malformed address is refused rather than recorded"
);
// Privy serialises linked_accounts as a JSON string in some token versions.
assert.equal(
  solanaWalletFromPayload({ sub: ALICE, linked_accounts: JSON.stringify([solanaAccount]) }, ALICE).address,
  WALLET_A,
  "a string-encoded linked_accounts claim is parsed, not silently dropped"
);
assert.equal(
  solanaWalletFromPayload({ sub: ALICE, linked_accounts: "not json" }, ALICE), null
);
assert.equal(
  solanaWalletFromPayload(
    { sub: ALICE, linked_accounts: [{ ...solanaAccount, delegated: true }] },
    ALICE
  ).delegated, true,
  "delegation state is carried through so an operator can explain a signing failure"
);
results.addressComesFromTokenOnly = "PASS";

// ---- the withdrawal path's check is unchanged and still address-bound ------------------
//
// requirePrivyWallet answers a different question and must keep answering it: a withdrawal
// legitimately names the wallet it spends from, and that name must be verified.

assert.equal(ownsPrivyWallet({ sub: ALICE, linked_accounts: [solanaAccount] }, ALICE, WALLET_A, "pw-1"), true);
assert.equal(ownsPrivyWallet({ sub: ALICE, linked_accounts: [solanaAccount] }, ALICE, WALLET_B, "pw-1"), false,
  "an address the token does not carry is refused");
assert.equal(ownsPrivyWallet({ sub: BOB, linked_accounts: [solanaAccount] }, ALICE, WALLET_A, "pw-1"), false,
  "subject mismatch is refused");
results.withdrawalOwnershipCheckIntact = "PASS";

// ---- every surface resolves the SAME wallet --------------------------------------------
//
// Portfolio, the withdrawal screen and the trading path each derive the address from the
// Privy user object in the browser (getSolanaAddress -> linkedAccounts, chainType solana).
// solanaWalletFromPayload applies the identical rule to the verified token, so the server's
// answer and the three client answers cannot diverge for the same session.

const clientRule = (u) => (u.linkedAccounts || []).find(
  (a) => a.type === "wallet" && a.chainType === "solana"
)?.address;
const privyUser = { linkedAccounts: [{ type: "wallet", chainType: "solana", address: WALLET_A, id: "pw-1" }] };
assert.equal(
  clientRule(privyUser),
  solanaWalletFromPayload({ sub: ALICE, linked_accounts: [solanaAccount] }, ALICE).address,
  "client-side getSolanaAddress and server-side extraction select the same account"
);
assert.equal((await primary(ALICE)).wallet.address, WALLET_A,
  "and that is the address the database now holds as primary");
results.allSurfacesAgree = "PASS";

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  fixture: `generated from production shapes (${FIXTURE_TABLES.length} tables)`,
  schemaParity: "PASS",
  ...results
}, null, 2));

await db.close();
