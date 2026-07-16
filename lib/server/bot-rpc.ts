export function getBotBridgeUrl() {
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base}/functions/v1/bot-bridge` : null;
}

export const botBridgeHeaders = { "content-type": "application/json" };
