/**
 * Environment access. Every secret is read here and nowhere else, so there is one
 * place to audit. Nothing in this file has a default value — a missing secret must
 * fail loudly at the call site rather than quietly running with a placeholder.
 */

export type EnvName =
  | "XZY_BOT_TOKEN"
  | "XZY_BOT_USERNAME"
  | "TELEGRAM_WEBHOOK_SECRET"
  | "TELEGRAM_WEBHOOK_PATH"
  | "SUPABASE_URL"
  | "SUPABASE_SERVICE_KEY"
  | "ADMIN_TELEGRAM_IDS"
  | "PUBLIC_APP_URL"
  | "WALLET_ENCRYPTION_KEY"
  | "SOLANA_RPC_URL"
  | "TRADING_MODE"
  | "CRON_SECRET"
  | "JUPITER_API_URL"
  | "PRICE_API_URL"
  | "PLATFORM_FEE_ACCOUNT"
  | "PLATFORM_FEE_BPS"
  | "CHANNEL_FEE_SHARE_BPS";

export function optionalEnv(name: EnvName): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function requireEnv(name: EnvName): string {
  const value = optionalEnv(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Telegram user IDs allowed into the admin surface, as a comma-separated list.
 * Numeric IDs only — usernames are reassignable and must never gate admin access.
 */
export function adminTelegramIds(): Set<string> {
  const raw = optionalEnv("ADMIN_TELEGRAM_IDS");
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => /^\d+$/.test(part))
  );
}

/** True when the server has everything it needs to talk to Telegram and the DB. */
export function isConfigured(): boolean {
  return Boolean(
    optionalEnv("XZY_BOT_TOKEN") &&
      optionalEnv("TELEGRAM_WEBHOOK_SECRET") &&
      optionalEnv("SUPABASE_URL") &&
      optionalEnv("SUPABASE_SERVICE_KEY")
  );
}
