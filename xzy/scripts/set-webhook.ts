/**
 * Registers this deployment's webhook with Telegram.
 *
 * Run once after deploying, and again whenever PUBLIC_APP_URL or the webhook secrets
 * change:  node --experimental-strip-types scripts/set-webhook.ts
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    console.error(`Missing ${name}. Set it before running this script.`);
    process.exit(1);
  }
  return value.trim();
}

const token = required("XZY_BOT_TOKEN");
const appUrl = required("PUBLIC_APP_URL").replace(/\/+$/, "");
const secret = required("TELEGRAM_WEBHOOK_SECRET");
const path = required("TELEGRAM_WEBHOOK_PATH");

if (!appUrl.startsWith("https://")) {
  console.error("PUBLIC_APP_URL must be https — Telegram refuses webhooks over plain http.");
  process.exit(1);
}

const url = `${appUrl}/api/tg/webhook/${path}`;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    // Channel posts and membership changes are the two the bot actually needs.
    // my_chat_member is NOT delivered by default and must be requested explicitly.
    allowed_updates: ["message", "channel_post", "edited_channel_post", "my_chat_member", "callback_query"],
    drop_pending_updates: true
  })
});

const body = (await res.json()) as { ok?: boolean; description?: string };
if (!body.ok) {
  console.error(`setWebhook failed: ${body.description ?? "unknown error"}`);
  process.exit(1);
}

// The token is deliberately not printed, and the URL contains the secret path segment,
// so only the host is echoed back.
console.log(`Webhook registered at ${new URL(url).host}/api/tg/webhook/<path>`);

export {};
