import { db } from "../lib/db/client.ts";
import { sendMessage, answerCallbackQuery } from "../lib/telegram/api.ts";
import { optionalEnv } from "../lib/env.ts";
import type { Channel } from "../lib/db/types.ts";
import { copyCall } from "./copy.ts";
import { createCopyDeps } from "./trading-deps.ts";
import type { WebhookDeps, ListChannelInput, RecordCallInput } from "./webhook.ts";

/** Real implementations of the webhook's side effects, backed by Supabase and Telegram. */

async function getChannel(chatId: string): Promise<Channel | null> {
  const rows = await db<Channel[]>(`channels?chat_id=eq.${encodeURIComponent(chatId)}&select=*&limit=1`);
  return rows?.[0] ?? null;
}

async function listChannel(input: ListChannelInput): Promise<Channel | null> {
  // Re-listing an existing channel must not reset its review state: a channel that was
  // already approved stays approved when the bot is re-promoted, and a rejected one
  // does not quietly become pending again.
  const existing = await getChannel(input.chatId);
  if (existing) {
    const rows = await db<Channel[]>(`channels?chat_id=eq.${encodeURIComponent(input.chatId)}`, {
      method: "PATCH",
      body: {
        title: input.title,
        username: input.username,
        status: existing.status === "removed" ? "pending" : existing.status
      }
    });
    return rows?.[0] ?? existing;
  }

  const rows = await db<Channel[]>("channels", {
    method: "POST",
    body: {
      chat_id: input.chatId,
      title: input.title,
      username: input.username,
      listed_by_tg_id: input.listedByTgId,
      status: "pending"
    }
  });
  return rows?.[0] ?? null;
}

async function markChannelRemoved(chatId: string) {
  return db(`channels?chat_id=eq.${encodeURIComponent(chatId)}`, {
    method: "PATCH",
    body: { status: "removed" }
  });
}

async function recordCall(input: RecordCallInput): Promise<{ accepted: boolean; id: string | null }> {
  // The unique index on (chat_id, message_id, event_version, mint) is what makes this
  // idempotent. Telegram redelivers updates freely, so dedup lives in the database
  // rather than in any in-process memory that a restart would lose.
  const rows = await db<{ id: string }[]>("calls?on_conflict=chat_id,message_id,event_version,mint", {
    method: "POST",
    body: {
      channel_id: input.channelId,
      chat_id: input.chatId,
      mint: input.mint,
      message_id: input.messageId,
      confidence: input.confidence,
      event_version: input.eventVersion,
      caller: input.caller,
      called_at: input.postedAt.toISOString()
    },
    prefer: "return=representation,resolution=ignore-duplicates"
  });
  const id = rows?.[0]?.id ?? null;
  return { accepted: Boolean(id), id };
}

async function upsertUser(input: { tgId: string; username: string | null; firstName: string | null }) {
  return db("users?on_conflict=tg_id", {
    method: "POST",
    body: { tg_id: input.tgId, username: input.username, first_name: input.firstName },
    prefer: "return=minimal,resolution=merge-duplicates"
  });
}

export function createWebhookDeps(): WebhookDeps {
  return {
    sendMessage: (chatId, text, options) => sendMessage(chatId, text, options),
    answerCallbackQuery: (id, text) => answerCallbackQuery(id, text),
    getChannel,
    listChannel,
    markChannelRemoved,
    recordCall,
    upsertUser,
    dispatchCopy: (input) =>
      copyCall({ id: input.callId, channelId: input.channelId, mint: input.mint }, createCopyDeps()),
    miniAppUrl: optionalEnv("PUBLIC_APP_URL") ?? "https://example.invalid",
    now: () => new Date()
  };
}
