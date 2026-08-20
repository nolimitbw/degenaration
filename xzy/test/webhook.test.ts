import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUpdate } from "../server/webhook.ts";
import type { WebhookDeps, RecordCallInput, ListChannelInput } from "../server/webhook.ts";
import type { Channel } from "../lib/db/types.ts";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const CHANNEL_CHAT_ID = "-1001234567890";

function approvedChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "chan-uuid",
    chat_id: CHANNEL_CHAT_ID,
    title: "Alpha Calls",
    username: "alphacalls",
    listed_by_tg_id: "777",
    status: "approved",
    member_count: 1200,
    listed_at: "2026-01-01T00:00:00Z",
    approved_at: "2026-01-02T00:00:00Z",
    ...overrides
  };
}

type Harness = {
  deps: WebhookDeps;
  sent: { chatId: string; text: string }[];
  recorded: RecordCallInput[];
  listed: ListChannelInput[];
  removed: string[];
  dispatched: string[];
};

function harness(channel: Channel | null): Harness {
  const sent: { chatId: string; text: string }[] = [];
  const recorded: RecordCallInput[] = [];
  const listed: ListChannelInput[] = [];
  const removed: string[] = [];
  const dispatched: string[] = [];
  // Mirrors the database's unique index so dedup behaviour is exercised, not assumed.
  const seen = new Set<string>();

  const deps: WebhookDeps = {
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
    },
    async answerCallbackQuery() {},
    async getChannel() {
      return channel;
    },
    async listChannel(input) {
      listed.push(input);
      return approvedChannel({ status: "pending", approved_at: null });
    },
    async markChannelRemoved(chatId) {
      removed.push(chatId);
    },
    async recordCall(input) {
      const key = [input.chatId, input.messageId, input.eventVersion, input.mint].join(":");
      if (seen.has(key)) return { accepted: false, id: null };
      seen.add(key);
      recorded.push(input);
      return { accepted: true, id: `call-${recorded.length}` };
    },
    async upsertUser() {},
    async getWallet() {
      return { address: "wallet-address", balanceSol: 1.5 };
    },
    async listPositions() {
      return [];
    },
    async manualBuy() {
      return { ok: true, message: "bought" };
    },
    async manualSell() {
      return { ok: true, message: "sold" };
    },
    async dispatchCopy(input) {
      dispatched.push(input.callId);
    },
    miniAppUrl: "https://xzy.example/app",
    now: () => new Date("2026-01-01T00:00:00Z")
  };

  return { deps, sent, recorded, listed, removed, dispatched };
}

function channelPost(text: string, messageId = 10) {
  return {
    channel_post: {
      message_id: messageId,
      chat: { id: Number(CHANNEL_CHAT_ID), type: "channel" as const, title: "Alpha Calls" },
      text,
      date: 1_767_225_600
    }
  };
}

test("records a call from an approved channel", async () => {
  const h = harness(approvedChannel());
  const outcome = await handleUpdate(channelPost(`send it ${BONK}`), h.deps);

  assert.equal(outcome.kind, "calls_recorded");
  assert.equal(outcome.callsRecorded, 1);
  assert.equal(h.recorded[0]?.mint, BONK);
  assert.equal(h.recorded[0]?.channelId, "chan-uuid");
  assert.equal(h.recorded[0]?.eventVersion, "original");
});

test("records one call per mint when a post names several", async () => {
  const h = harness(approvedChannel());
  const outcome = await handleUpdate(channelPost(`${BONK} and ${WIF}`), h.deps);

  assert.equal(outcome.callsRecorded, 2);
  assert.deepEqual(h.recorded.map((call) => call.mint).sort(), [BONK, WIF].sort());
});

test("ignores posts from a channel that was never listed", async () => {
  const h = harness(null);
  const outcome = await handleUpdate(channelPost(`${BONK}`), h.deps);

  assert.equal(outcome.kind, "post_from_unlisted_channel");
  assert.equal(h.recorded.length, 0);
});

test("listing is not approval — a pending channel's posts are not recorded", async () => {
  const h = harness(approvedChannel({ status: "pending", approved_at: null }));
  const outcome = await handleUpdate(channelPost(`${BONK}`), h.deps);

  assert.equal(outcome.kind, "post_from_unapproved_channel");
  assert.equal(h.recorded.length, 0);
});

test("a rejected channel's posts are not recorded", async () => {
  const h = harness(approvedChannel({ status: "rejected" }));
  const outcome = await handleUpdate(channelPost(`${BONK}`), h.deps);

  assert.equal(outcome.kind, "post_from_unapproved_channel");
  assert.equal(h.recorded.length, 0);
});

test("a redelivered identical update records the call only once", async () => {
  const h = harness(approvedChannel());
  const update = channelPost(`${BONK}`, 55);

  const first = await handleUpdate(update, h.deps);
  const second = await handleUpdate(update, h.deps);

  assert.equal(first.callsRecorded, 1);
  assert.equal(second.callsRecorded, 0, "Telegram retries must not double-record a call");
  assert.equal(h.recorded.length, 1);
});

test("an edited post is a distinct event, not an overwrite of the original", async () => {
  const h = harness(approvedChannel());
  await handleUpdate(channelPost(`${BONK}`, 77), h.deps);
  await handleUpdate(
    {
      edited_channel_post: {
        message_id: 77,
        chat: { id: Number(CHANNEL_CHAT_ID), type: "channel", title: "Alpha Calls" },
        text: `${BONK} ${WIF}`,
        date: 1_767_225_600,
        edit_date: 1_767_226_000
      }
    },
    h.deps
  );

  assert.equal(h.recorded.length, 3, "original call plus both mints from the edited version");
  assert.equal(h.recorded[0]?.eventVersion, "original");
  assert.equal(h.recorded[1]?.eventVersion, "edit:1767226000");
});

test("a post with no mint records nothing", async () => {
  const h = harness(approvedChannel());
  const outcome = await handleUpdate(channelPost("gm, market looking heavy today"), h.deps);

  assert.equal(outcome.kind, "no_calls_in_post");
  assert.equal(h.recorded.length, 0);
});

test("promoting the bot to admin lists the channel and tells the promoter", async () => {
  const h = harness(null);
  const outcome = await handleUpdate(
    {
      my_chat_member: {
        chat: { id: Number(CHANNEL_CHAT_ID), type: "channel", title: "Alpha Calls", username: "alphacalls" },
        from: { id: 777, first_name: "Owner" },
        new_chat_member: { status: "administrator" },
        old_chat_member: { status: "left" }
      }
    },
    h.deps
  );

  assert.equal(outcome.kind, "channel_listed");
  assert.equal(h.listed[0]?.chatId, CHANNEL_CHAT_ID);
  assert.equal(h.listed[0]?.listedByTgId, "777", "the promoter is our ownership proof");
  assert.equal(h.sent[0]?.chatId, "777");
  assert.match(h.sent[0]?.text ?? "", /pending review/i);
});

test("losing admin stops the listing", async () => {
  const h = harness(approvedChannel());
  const outcome = await handleUpdate(
    {
      my_chat_member: {
        chat: { id: Number(CHANNEL_CHAT_ID), type: "channel", title: "Alpha Calls" },
        from: { id: 777 },
        new_chat_member: { status: "kicked" },
        old_chat_member: { status: "administrator" }
      }
    },
    h.deps
  );

  assert.equal(outcome.kind, "channel_removed");
  assert.deepEqual(h.removed, [CHANNEL_CHAT_ID]);
});

test("/start replies with the app button", async () => {
  const h = harness(null);
  const outcome = await handleUpdate(
    { message: { message_id: 1, chat: { id: 777, type: "private" }, from: { id: 777, first_name: "Ada" }, text: "/start" } },
    h.deps
  );

  assert.equal(outcome.kind, "command");
  assert.equal(outcome.detail, "/start");
  assert.match(h.sent[0]?.text ?? "", /Xzy/);
});

test("a handler failure is swallowed so Telegram does not retry forever", async () => {
  const h = harness(approvedChannel());
  const failing: WebhookDeps = {
    ...h.deps,
    async recordCall() {
      throw new Error("database on fire");
    }
  };

  const outcome = await handleUpdate(channelPost(`${BONK}`), failing);
  assert.equal(outcome.kind, "ignored");
  assert.match(outcome.detail ?? "", /database on fire/);
});

test("a malformed update is ignored rather than crashing the webhook", async () => {
  const h = harness(approvedChannel());
  assert.equal((await handleUpdate({}, h.deps)).kind, "ignored");
  assert.equal((await handleUpdate({ channel_post: {} }, h.deps)).kind, "ignored");
});

test("/start still replies when the user table is unreachable", async () => {
  // The reply is the product's front door. A database outage must not turn /start
  // into silence — the profile row is rewritten on the user's next message anyway.
  const h = harness(null);
  const failing: WebhookDeps = {
    ...h.deps,
    async upsertUser() {
      throw new Error("database unreachable");
    }
  };

  const outcome = await handleUpdate(
    { message: { message_id: 1, chat: { id: 777, type: "private" }, from: { id: 777 }, text: "/start" } },
    failing
  );

  assert.equal(outcome.kind, "command");
  assert.equal(h.sent.length, 1, "the user must still get a reply");
});

test("an accepted call is dispatched to the copy engine exactly once", async () => {
  const h = harness(approvedChannel());
  const update = channelPost(`${BONK}`, 91);

  await handleUpdate(update, h.deps);
  await handleUpdate(update, h.deps); // redelivery

  assert.deepEqual(h.dispatched, ["call-1"], "the duplicate must not trigger a second copy");
});

test("a call from an unapproved channel is never dispatched", async () => {
  const h = harness(approvedChannel({ status: "pending", approved_at: null }));
  await handleUpdate(channelPost(`${BONK}`), h.deps);
  assert.deepEqual(h.dispatched, []);
});

test("/positions lists holdings with a sell button for each", async () => {
  const h = harness(null);
  const deps: WebhookDeps = {
    ...h.deps,
    async listPositions() {
      return [
        { id: "11111111-1111-1111-1111-111111111111", symbol: "BONK", mint: BONK, amountSol: 0.25, changePct: 42.5, remainingPct: 100 },
        { id: "22222222-2222-2222-2222-222222222222", symbol: null, mint: WIF, amountSol: 0.1, changePct: null, remainingPct: 50 }
      ];
    }
  };

  const outcome = await handleUpdate(
    { message: { message_id: 1, chat: { id: 777, type: "private" }, from: { id: 777 }, text: "/positions" } },
    deps
  );

  assert.equal(outcome.detail, "/positions");
  const text = h.sent[0]?.text ?? "";
  assert.match(text, /BONK/);
  assert.match(text, /\+42\.5%/);
  assert.match(text, /—/, "an unpriced position shows a dash, never 0%");
});

test("/buy rejects a malformed command instead of guessing an amount", async () => {
  const h = harness(null);
  let called = false;
  const deps: WebhookDeps = {
    ...h.deps,
    async manualBuy() {
      called = true;
      return { ok: true, message: "bought" };
    }
  };

  await handleUpdate(
    { message: { message_id: 1, chat: { id: 777, type: "private" }, from: { id: 777 }, text: "/buy" } },
    deps
  );
  assert.equal(called, false);
  assert.match(h.sent[0]?.text ?? "", /Usage/);

  await handleUpdate(
    { message: { message_id: 2, chat: { id: 777, type: "private" }, from: { id: 777 }, text: `/buy ${BONK} -5` } },
    deps
  );
  assert.equal(called, false, "a negative amount must not reach the trade path");
});

test("/buy passes a well-formed command through", async () => {
  const h = harness(null);
  const seen: { mint: string; amountSol: number }[] = [];
  const deps: WebhookDeps = {
    ...h.deps,
    async manualBuy(input) {
      seen.push({ mint: input.mint, amountSol: input.amountSol });
      return { ok: true, message: "Bought." };
    }
  };

  await handleUpdate(
    { message: { message_id: 1, chat: { id: 777, type: "private" }, from: { id: 777 }, text: `/buy ${BONK} 0.25` } },
    deps
  );
  assert.deepEqual(seen, [{ mint: BONK, amountSol: 0.25 }]);
});

test("a Sell button sells that position and reports back", async () => {
  const h = harness(null);
  const sells: { positionId: string; fraction: number }[] = [];
  const deps: WebhookDeps = {
    ...h.deps,
    async manualSell(input) {
      sells.push({ positionId: input.positionId, fraction: input.fraction });
      return { ok: true, message: "Sold." };
    }
  };

  const outcome = await handleUpdate(
    {
      callback_query: {
        id: "cb1",
        from: { id: 777 },
        data: "sell:11111111-1111-1111-1111-111111111111:100"
      }
    },
    deps
  );

  assert.equal(outcome.kind, "callback");
  assert.deepEqual(sells, [{ positionId: "11111111-1111-1111-1111-111111111111", fraction: 1 }]);
  assert.equal(h.sent[0]?.text, "Sold.");
});

test("a malformed callback never reaches the trade path", async () => {
  const h = harness(null);
  let called = false;
  const deps: WebhookDeps = {
    ...h.deps,
    async manualSell() {
      called = true;
      return { ok: true, message: "sold" };
    }
  };

  await handleUpdate({ callback_query: { id: "cb", from: { id: 777 }, data: "sell:not-a-uuid:100" } }, deps);
  await handleUpdate({ callback_query: { id: "cb", from: { id: 777 }, data: "sell:11111111-1111-1111-1111-111111111111:900" } }, deps);
  assert.equal(called, false);
});

test("/sell defaults to the whole position when no percentage is given", async () => {
  const h = harness(null);
  const sells: number[] = [];
  const deps: WebhookDeps = {
    ...h.deps,
    async manualSell(input) {
      sells.push(input.fraction);
      return { ok: true, message: "Sold." };
    }
  };

  await handleUpdate(
    {
      message: {
        message_id: 1,
        chat: { id: 777, type: "private" },
        from: { id: 777 },
        text: "/sell 11111111-1111-1111-1111-111111111111"
      }
    },
    deps
  );
  assert.deepEqual(sells, [1]);
});
