/**
 * Preflight: does this deployment have what it needs?
 *
 * Run before going live, and any time the bot behaves oddly:
 *   node --experimental-strip-types scripts/preflight.ts
 *
 * Checks configuration only — it never sends a transaction. Secrets are reported as
 * present or missing, never printed.
 */

type Level = "ok" | "warn" | "fail";
type Check = { level: Level; label: string; detail: string };

const checks: Check[] = [];
const env = (name: string) => {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const add = (level: Level, label: string, detail: string) => checks.push({ level, label, detail });

function required(name: string, note: string) {
  add(env(name) ? "ok" : "fail", name, env(name) ? "set" : note);
}

// --- Telegram ---
required("XZY_BOT_TOKEN", "missing — the bot cannot authenticate to Telegram");
required("TELEGRAM_WEBHOOK_SECRET", "missing — the webhook rejects every request");
required("TELEGRAM_WEBHOOK_PATH", "missing — the webhook route returns 404");

const appUrl = env("PUBLIC_APP_URL");
if (!appUrl) {
  add("fail", "PUBLIC_APP_URL", "missing — the Open Xzy button has nowhere to point");
} else if (!appUrl.startsWith("https://")) {
  add("fail", "PUBLIC_APP_URL", "must be https — Telegram refuses Mini Apps over plain http");
} else {
  add("ok", "PUBLIC_APP_URL", appUrl);
}

// --- Database ---
required("SUPABASE_URL", "missing — channels, calls and positions cannot be stored");
required("SUPABASE_SERVICE_KEY", "missing — every database call will fail");

// --- Wallets ---
const encryptionKey = env("WALLET_ENCRYPTION_KEY");
if (!encryptionKey) {
  add("fail", "WALLET_ENCRYPTION_KEY", "missing — wallets cannot be created or decrypted");
} else if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
  add(
    "warn",
    "WALLET_ENCRYPTION_KEY",
    "not 64 hex chars — it still works (the value is hashed to a key) but `openssl rand -hex 32` is stronger"
  );
} else {
  add("ok", "WALLET_ENCRYPTION_KEY", "set — make sure this is backed up; losing it loses every wallet");
}

// --- Scheduler ---
required("CRON_SECRET", "missing — the monitor and scanner endpoints refuse to run");

// --- Trading ---
const mode = env("TRADING_MODE");
if (mode === "live") {
  add("warn", "TRADING_MODE", "LIVE — real funds will move");
  if (!env("SOLANA_RPC_URL")) {
    add("warn", "SOLANA_RPC_URL", "unset — the public endpoint is rate-limited and will drop trades under load");
  }
  add("warn", "probe", "run `npm run probe:jupiter` and confirm it passes before trusting live mode");
} else {
  add("ok", "TRADING_MODE", "simulation — quotes are real, nothing is submitted");
}

const feeAccount = env("PLATFORM_FEE_ACCOUNT");
add(
  feeAccount ? "ok" : "warn",
  "PLATFORM_FEE_ACCOUNT",
  feeAccount ? "set" : "unset — fees still accrue in the ledger, but nothing can be paid out"
);

// --- Report ---
const symbol = { ok: "OK  ", warn: "WARN", fail: "FAIL" } as const;
for (const check of checks) {
  console.log(`${symbol[check.level]}  ${check.label.padEnd(26)} ${check.detail}`);
}

const failures = checks.filter((check) => check.level === "fail").length;
const warnings = checks.filter((check) => check.level === "warn").length;

console.log("");
if (failures > 0) {
  console.log(`${failures} blocking problem${failures === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`);
  console.log("Fix the FAIL lines — the app will not work correctly until they are set.");
  process.exit(1);
}
console.log(`Configuration looks complete. ${warnings} warning${warnings === 1 ? "" : "s"} to review.`);
export {};
