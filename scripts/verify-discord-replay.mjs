/**
 * The Discord chain, composed: gateway event -> journal -> call -> subscriber -> intent.
 *
 * WHY THIS EXISTS
 *
 * Every stage of Discord ingestion had a verifier and none of them proved the stages COMPOSE.
 * `verify:discord-ingestion` starts at the RPC, one step after the listener. `verify:signal-
 * fanout` starts at parsed_signals, one step after that. The listener's own decision logic —
 * the approved-channel gate, the reply fallback, the late-embed case, the delete gate — was
 * unreachable by any test at all, because index.js registered its handlers at module scope
 * and called client.login() on import. So the exact code deployed to Railway was the only
 * part of the chain that had never been executed outside production.
 *
 * WHAT COMPOSING THEM FOUND
 *
 * `app_private.fan_out_parsed_signal` resolved its source with
 * `join public.call_channels ch on ch.channel_id = rs.source_ref`, and
 * `bot_ingest_discord_signal_v2` writes source_ref as `discord:<guild>:<channel>`. The join
 * could never match. Every real Discord call would be journaled as accepted, counted by the
 * marketplace, and offered to ZERO subscribers — silently, because fan_out_on_parse is an
 * AFTER INSERT trigger that discards the return value. Confirmed against production before
 * it was fixed; the control run at the end of this file reproduces it.
 *
 * The reason it was green: verify:signal-fanout's fixture wrote `source_ref = 'chan-1'`, a
 * bare channel id that ingestion has never produced. The fixture agreed with the reader
 * instead of with the writer. That is this project's recurring failure mode, and it is the
 * reason this file drives real code from a stored event rather than hand-built rows.
 *
 * WHAT IS AND IS NOT PROVEN
 *
 * Proven: the listener's handlers, the delivery payload, the route's validation, confidence
 * and content-hash decisions, the immutable call-time price selection, the ingest RPC, the
 * call journal, subscriber fan-out and the configuration snapshot captured with it.
 * Not proven here: that Discord delivers such an event to the deployed process. That is E-2,
 * and it needs a live automated call, not more code.
 *
 * Nothing is signed, submitted or broadcast. No network call is made.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { renderTables, assertSchemaParity } from "./lib/production-schema.mjs";

const require = createRequire(import.meta.url);
const repo = process.cwd();

// The REAL modules, not reimplementations. If any of these changes shape, this fails.
const { parseMessage } = require(`${repo}/server/bot/parser.js`);
const { buildIngestPayload } = require(`${repo}/server/bot/ingest.js`);
const { createMessageHandlers, IngestedMessages, describeShape } = require(`${repo}/server/bot/handlers.js`);
const { normalizeIngestRequest, selectPricePair, buildIngestRpcParams } = require(`${repo}/lib/discord-ingest.js`);

const fixture = JSON.parse(await readFile(`${repo}/server/test/fixtures/discord-events.json`, "utf8"));
const { ids, mints } = fixture;
const results = {};

// ─── database ────────────────────────────────────────────────────────────────────────────
const read = (f) => readFile(`${repo}/supabase/${f}`, "utf8");
const [ingestSql, fanoutSql, fanoutFixSql, editFixSql, authSql, profilesSql, rejectedSql] = await Promise.all([
  read("degenaration-discord-signal-ingestion.sql"),
  read("degenaration-signal-fanout.sql"),
  read("degenaration-signal-fanout-source-ref.sql"),
  read("degenaration-discord-edit-retraction.sql"),
  read("degenaration-registered-channel-authorization.sql"),
  // #12 rebuilds bot_approved_call_channels, which this file defines. Applying it first keeps
  // the chain in the order production applies it.
  read("degenaration-discord-public-profiles.sql"),
  read("degenaration-discord-rejected-signals.sql")
]);

const T = ["public.approved_groups", "public.call_channels", "public.calls", "app_private.bot_config_versions"];

async function freshDb({ withFanoutFix = true, withEditFix = true, withAuthFix = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema app_private;
    create function app_private.bot_secret_ok(p text) returns boolean
    language sql stable security definer set search_path='' as $x$ select p is not null and p='bot-secret' $x$;
  `);
  await db.exec(renderTables(T));
  await assertSchemaParity(db, T, assert);
  await db.exec(`
    create table app_private.raw_signals (id uuid primary key default gen_random_uuid(),
      source_type text not null, source_ref text not null, external_event_id text,
      event_version text, immutable_payload jsonb not null, content_hash text not null,
      received_at timestamptz not null default now(),
      edited_at timestamptz, deleted_at timestamptz);
    alter table app_private.raw_signals
      add constraint raw_signals_source_ref_external_key unique (source_type, source_ref, external_event_id);
    create unique index raw_signals_source_content_unique
      on app_private.raw_signals (source_type, source_ref, content_hash);
    create table app_private.parsed_signals (id uuid primary key default gen_random_uuid(),
      raw_signal_id uuid not null references app_private.raw_signals(id), parser_version text not null,
      status text not null, mint text, confidence_bps integer, rejection_reason text,
      normalized_payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      constraint parsed_signals_raw_parser_key unique (raw_signal_id, parser_version));
    create table app_private.bot_profiles (id uuid primary key default gen_random_uuid(),
      owner_privy_user_id text not null, kind text not null,
      source_group_id uuid, status text not null default 'active');
    create table app_private.signal_deliveries (id uuid primary key default gen_random_uuid(),
      parsed_signal_id uuid not null references app_private.parsed_signals(id),
      bot_id uuid not null, config_version_id uuid not null,
      idempotency_key text not null unique, status text not null,
      evaluation jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), finished_at timestamptz);
    create unique index calls_message_id_unique
      on public.calls (message_id) where message_id is not null;
  `);
  await db.exec(ingestSql);
  if (withEditFix) await db.exec(editFixSql);
  if (withAuthFix) await db.exec(authSql);
  if (withAuthFix) await db.exec(rejectedSql);
  await db.exec(fanoutSql);
  if (withFanoutFix) await db.exec(fanoutFixSql);

  const group = "aaaaaaaa-0000-0000-0000-000000000001";
  await db.query("insert into public.approved_groups (id,name) values ($1::uuid,'Alpha Desk')", [group]);
  await db.query(`insert into public.call_channels (group_id,guild_id,channel_id,channel_name,status)
    values ($1::uuid,$2::text,$3::text,'alpha-calls','approved')`, [group, ids.guild, ids.approvedChannel]);
  // Exists but PENDING. An absent channel would be refused by the join finding nothing, which
  // tests the join rather than the approval gate.
  await db.query(`insert into public.call_channels (group_id,guild_id,channel_id,channel_name,status)
    values ($1::uuid,$2::text,$3::text,'off-topic','pending')`, [group, ids.guild, ids.unapprovedChannel]);
  return { db, group };
}

// ─── the listener, driven by a stored event ──────────────────────────────────────────────
/**
 * Wire the real handlers exactly as index.js does, with the network boundary replaced by a
 * recorder. Everything above that boundary is production code.
 */
function makeListener({ db, approvedChannels, onPayload }) {
  const delivered = [];
  const logged = [];
  const acknowledged = [];
  const ingested = new IngestedMessages();
  // The create path discards ingestEvent's return value, so the last outcome is captured here.
  const state = { lastOutcome: null };
  const handlers = createMessageHandlers({
    parseMessage,
    approvedChannel: (channelId) => approvedChannels[channelId],
    selfId: () => ids.selfApplication,
    log: (event, fields) => logged.push({ event, ...fields }),
    noteFreshness: () => {},
    acknowledge: async (entry) => acknowledged.push(entry),
    ingested,
    onError: (scope, error) => { throw new Error(`${scope}: ${error.message}`); },
    // The one seam. index.js posts this to /api/ingest-call; here the same payload goes
    // straight into the route's own transformation, so nothing between the two is skipped.
    ingestEvent: async (args) => {
      const payload = buildIngestPayload(args);
      delivered.push(payload);
      const outcome = await onPayload(payload);
      state.lastOutcome = outcome;
      if (outcome?.accepted === true && outcome?.duplicate !== true && args.eventType !== "delete") {
        ingested.remember(args.messageId);
      }
      return outcome;
    }
  });
  return { handlers, delivered, logged, acknowledged, ingested, db, get lastOutcome() { return state.lastOutcome; } };
}

/** The route's half: validate, price, call the RPC. No network — the price response is stored. */
async function routeIngest(db, payload) {
  const normalized = normalizeIngestRequest(payload);
  if (!normalized.ok) return { routeError: normalized.error, status: normalized.status };
  const price = normalized.mint === mints.primary
    ? selectPricePair(fixture.dexscreener, normalized.mint)
    : selectPricePair({ pairs: [] }, normalized.mint);
  const p = buildIngestRpcParams({ normalized, price, secret: "bot-secret" });
  if (p.operation === "ingest_rejection") {
    const { rows } = await db.query(
      `select public.bot_record_discord_rejection(
         p_secret => $1::text, p_guild_id => $2::text, p_channel_id => $3::text,
         p_channel_name => $4::text, p_message_id => $5::text, p_caller => $6::text,
         p_event_type => $7::text, p_event_version => $8::text,
         p_rejection_reason => $9::text, p_parser_version => $10::text,
         p_content_hash => $11::text) as r`,
      [p.p_secret, p.p_guild_id, p.p_channel_id, p.p_channel_name, p.p_message_id,
       p.p_caller, p.p_event_type, p.p_event_version, p.p_rejection_reason,
       p.p_parser_version, p.p_content_hash]
    );
    return { ...rows[0].r, normalized, price };
  }
  // Named arguments, exactly as PostgREST calls it. Positional would silently keep passing if
  // the signature gained an argument in the middle, which is how a guild ends up in a channel
  // parameter.
  const { rows } = await db.query(
    `select public.bot_ingest_discord_signal_v2(
       p_secret => $1::text, p_guild_id => $2::text, p_channel_id => $3::text,
       p_channel_name => $4::text, p_mint => $5::text, p_symbol => $6::text,
       p_called_mcap => $7::numeric, p_called_price_usd => $8::numeric,
       p_called_liquidity_usd => $9::numeric, p_message_id => $10::text, p_caller => $11::text,
       p_confidence => $12::text, p_event_type => $13::text, p_event_version => $14::text,
       p_edited_at => $15::timestamptz, p_parser_version => $16::text,
       p_confidence_bps => $17::integer, p_content_hash => $18::text) as r`,
    [p.p_secret, p.p_guild_id, p.p_channel_id, p.p_channel_name, p.p_mint, p.p_symbol,
     p.p_called_mcap, p.p_called_price_usd, p.p_called_liquidity_usd, p.p_message_id,
     p.p_caller, p.p_confidence, p.p_event_type, p.p_event_version, p.p_edited_at,
     p.p_parser_version, p.p_confidence_bps, p.p_content_hash]
  );
  return { ...rows[0].r, normalized, price };
}

// ─── run ─────────────────────────────────────────────────────────────────────────────────
const { db, group } = await freshDb();
const approvedChannels = { [ids.approvedChannel]: { groupId: group, groupName: "Alpha Desk" } };

// One live Discord bot following the source, with a configuration version in force.
const botId = (await db.query(`insert into app_private.bot_profiles
  (owner_privy_user_id, kind, source_group_id, status)
  values ('did:privy:replay','discord',$1::uuid,'active') returning id`, [group])).rows[0].id;
await db.query(`insert into app_private.bot_config_versions (bot_id, version, config, created_by)
  values ($1::uuid, 1, $2::jsonb, 'did:privy:replay')`,
  [botId, JSON.stringify({ buySol: 0.25, maxOpenTrades: 3, slippageBps: 300, takeProfit: [{ level: "TP1", targetX: 2, sellPct: 50 }], stopLossPct: 40 })]);

const outcomes = new Map();
const listener = makeListener({
  db, approvedChannels,
  onPayload: async (payload) => routeIngest(db, payload)
});
// ---- creates ----
for (const event of fixture.events) {
  const message = structuredClone(event.message);
  if (message._referenced) {
    const parent = message._referenced;
    delete message._referenced;
    // A reply's parent is read from the channel cache first; this is that cache.
    message.channel.messages = { cache: new Map([[parent.id, parent]]) };
  }
  const before = listener.delivered.length;
  const outcome = await listener.handlers.onMessageCreate(message);
  const wasDelivered = listener.delivered.length > before;
  outcomes.set(event.name, { outcome, payload: wasDelivered ? listener.delivered.at(-1) : null });

  assert.equal(wasDelivered, Boolean(event.expect.ingested),
    `${event.name}: ${event.why}`);
  if (event.expect.confidence) {
    assert.equal(listener.delivered.at(-1).confidence, event.expect.confidence,
      `${event.name}: the evidence label records WHERE the mint was found`);
  }
  if (event.expect.rejected) {
    const refusal = listener.logged.find((l) => l.event === "call.rejected" && l.messageId === message.id);
    assert.ok(refusal, `${event.name}: a refusal must be reported, not dropped silently`);
    assert.equal(refusal.reason, "ambiguous_mint");
    assert.equal(refusal.parserReason, event.expect.rejected);
  }
}
results.listenerGate = "PASS";

const ambiguous = outcomes.get("twoBareAddresses");
assert.equal(ambiguous.outcome.accepted, false);
assert.equal(ambiguous.outcome.reason, "ambiguous_mint");
assert.equal(ambiguous.outcome.duplicate, false);
const ambiguousMessage = fixture.events.find((event) => event.name === "twoBareAddresses").message;
const ambiguousRows = await db.query(`
  select ps.status, ps.rejection_reason,
         exists(select 1 from public.calls c where c.raw_event_id=rs.id) as made_call,
         exists(select 1 from app_private.signal_deliveries d where d.parsed_signal_id=ps.id) as made_delivery
  from app_private.raw_signals rs
  join app_private.parsed_signals ps on ps.raw_signal_id=rs.id
  where rs.external_event_id=$1::text`, [`${ambiguousMessage.id}:original`]);
assert.deepEqual(ambiguousRows.rows[0], {
  status: "rejected", rejection_reason: "ambiguous_mint", made_call: false, made_delivery: false
});
const ambiguousReplay = await routeIngest(db, ambiguous.payload);
assert.equal(ambiguousReplay.duplicate, true, "replayed ambiguity reuses immutable evidence");
results.ambiguousMintJournaled = "PASS";

assert.ok(listener.acknowledged.length > 0, "fresh accepted calls receive scanner acknowledgments");
assert.ok(listener.acknowledged.every((entry) => entry.outcome?.accepted === true && entry.outcome?.duplicate !== true),
  "only a fresh committed call can be acknowledged");
results.freshAcceptedAcknowledged = "PASS";

// Discord may surface a partial object when the message was not cached. The create path must
// hydrate it before applying the guild/channel and parser gates; treating the partial as an
// empty message loses the call with the same symptom as a missing MessageContent intent.
{
  const hydrated = {
    id: "1600000000000000801",
    content: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    guild: { id: ids.guild },
    channel: { id: ids.approvedChannel, name: "alpha-calls" },
    author: { id: "1400000000000000080", bot: true, username: "Partial Feed" }
  };
  const partial = { partial: true, fetch: async () => hydrated };
  const before = listener.delivered.length;
  await listener.handlers.onMessageCreate(partial);
  assert.equal(listener.delivered.length, before + 1, "a MESSAGE_CREATE partial is fetched and ingested");
  results.partialCreateHydrated = "PASS";
}

// ---- a message that is not a call must still be visible ----
//
// The branch that returns for an ordinary message looked like the one to stay quiet on, and
// staying quiet is what made the listener undiagnosable: on 2026-08-05 a real mint was posted
// in an approved channel and the process logged nothing at all, which is equally consistent
// with the gateway never delivering it, the bot being unable to read the channel, and the
// parser finding no mint. The shape is what separates those three.
{
  const chatter = {
    id: "1600000000000000201", content: "gm everyone",
    guild: { id: ids.guild },
    channel: { id: ids.approvedChannel, name: "alpha-calls" },
    author: { id: "1400000000000000050", bot: false, username: "member" }
  };
  const before = listener.delivered.length;
  await listener.handlers.onMessageCreate(chatter);
  assert.equal(listener.delivered.length, before, "ordinary chatter is not ingested");
  const ignored = listener.logged.find((l) => l.event === "call.ignored" && l.messageId === chatter.id);
  assert.ok(ignored, "a message in an approved channel that yields no mint MUST be logged");
  assert.equal(ignored.shape.contentLength, 11, "the shape records that content was received");
  assert.equal(ignored.shape.embeds, 0);

  // The signature of the fault the shape exists to expose: the process is being handed a
  // message with no content and no embeds, which no parser can rescue.
  const blind = { ...chatter, id: "1600000000000000202", content: "", embeds: [] };
  await listener.handlers.onMessageCreate(blind);
  const blindLog = listener.logged.find((l) => l.event === "call.ignored" && l.messageId === blind.id);
  assert.ok(blindLog, "an empty message must be logged too — that is the diagnostic case");
  assert.equal(blindLog.shape.contentLength, 0);
  assert.equal(blindLog.shape.embeds, 0,
    "contentLength 0 with embeds 0 is the permission/intent signature, and must be visible");

  // Shape is counts only. A call channel's text belongs to the source owner.
  const shape = describeShape({ content: "secret alpha", embeds: [{ title: "T", fields: [{ name: "CA", value: "x" }] }] });
  const serialized = JSON.stringify(shape);
  assert.ok(!serialized.includes("secret alpha"), "the shape must never carry message text");
  assert.ok(!serialized.includes("CA"), "the shape must never carry embed field names");
  assert.equal(shape.embedFields, 1);

  // A channel nobody approved is counted, not logged per message: one unapproved channel in a
  // busy guild would flood the log and bury the events that matter.
  const elsewhere = { ...chatter, id: "1600000000000000203", channel: { id: ids.unapprovedChannel, name: "off-topic" } };
  const loggedBefore = listener.logged.length;
  await listener.handlers.onMessageCreate(elsewhere);
  assert.equal(listener.logged.length, loggedBefore, "an unapproved channel does not log per message");
  assert.ok(listener.handlers.diagnostics().unapprovedMessages >= 1,
    "but it IS counted, so 'is the approved map correct?' has an answer");
  results.nonCallIsObservable = "PASS";

  // The verdict is the whole point: nine counters that an operator has to interpret is what
  // produced two rounds of guessing. It must name the fault, not the numbers.
  const d = listener.handlers.diagnostics();
  assert.ok(d.messagesReceived > 0, "messages seen must be counted");
  assert.ok(d.emptyPayload >= 1, "a message with no content, embeds or attachments is counted apart");
  assert.match(d.verdict, /arriving in watched channels/,
    "with real traffic in a watched channel the verdict must say so");

  // The case that cost two diagnostic rounds: nothing arriving at all.
  const quiet = makeListener({ db, approvedChannels, onPayload: () => ({ accepted: false }) });
  assert.match(quiet.handlers.diagnostics().verdict, /no MESSAGE_CREATE received since boot/,
    "a listener that has seen nothing must SAY it has seen nothing, not stay silent");

  // And the one that looks identical in a log but needs a completely different fix.
  const blindListener = makeListener({ db, approvedChannels, onPayload: () => ({ accepted: false }) });
  await blindListener.handlers.onMessageCreate({
    id: "1600000000000000301", content: "", embeds: [],
    guild: { id: ids.guild },
    channel: { id: ids.approvedChannel, name: "alpha-calls" },
    author: { id: "1400000000000000060", bot: false, username: "member" }
  });
  assert.match(blindListener.handlers.diagnostics().verdict, /cannot read message content/,
    "every message arriving empty is a permission fault and must be named as one");
  results.heartbeatVerdict = "PASS";
}

// The production shape reached the journal, with a real price attached.
const primary = outcomes.get("buttonOnlyEmbed").outcome;
assert.equal(primary.accepted, true, "the button-only embed is a journaled call");
assert.equal(primary.mint, mints.primary, "the mint came out of a button URL, not the message text");
results.buttonUrlCallJournaled = "PASS";

// ---- the immutable call-time price ----
assert.equal(primary.price.calledPrice, 0.00002341,
  "the deepest SOLANA pair whose BASE token is this mint sets the price");
assert.equal(primary.price.calledLiquidity, 4210000);
assert.equal(primary.price.calledMcap, 1723000000, "market cap, falling back to FDV only when absent");
assert.equal(primary.price.symbol, "BONK");
const stored = (await db.query(
  `select called_price_usd, peak_price_usd, latest_price_usd, called_mcap, called_liquidity_usd,
          symbol, parser_confidence, parse_status, confidence
   from public.calls where message_id = $1::text`, ["1600000000000000001"])).rows[0];
assert.equal(Number(stored.called_price_usd), 0.00002341, "and it is what the journal stored");
assert.equal(Number(stored.peak_price_usd), Number(stored.called_price_usd),
  "peak and latest start AT the call price — a call cannot begin already up");
assert.equal(Number(stored.parser_confidence), 0.95, "link evidence is 9500 bps, not the 7500 default");
assert.equal(stored.parse_status, "accepted");
results.immutableCallPrice = "PASS";

// A call whose pair cannot be resolved is journaled with a NULL price, never a fabricated one.
const wif = (await db.query(
  "select called_price_usd, symbol from public.calls where message_id = $1::text", ["1600000000000000002"])).rows[0];
assert.equal(wif.called_price_usd, null, "no resolvable pair means no price, not zero");
assert.equal(wif.symbol, null);
results.unpricedCallNotFabricated = "PASS";

// ---- subscriber fan-out: the composition that was broken ----
const deliveriesFor = async (messageId) => (await db.query(
  `select d.status, d.config_version_id, d.evaluation, d.idempotency_key, ps.mint, ps.confidence_bps
   from app_private.signal_deliveries d
   join app_private.parsed_signals ps on ps.id = d.parsed_signal_id
   join app_private.raw_signals rs on rs.id = ps.raw_signal_id
   where rs.immutable_payload->>'messageId' = $1::text`, [messageId])).rows;

const fanned = await deliveriesFor("1600000000000000001");
assert.equal(fanned.length, 1,
  "THE FIX: an ingested call reaches the bot following its source. Before this, the join " +
  "compared discord:<guild>:<channel> against a bare channel id and matched nothing.");
assert.equal(fanned[0].status, "pending");
assert.equal(fanned[0].evaluation.mint, mints.primary);
assert.equal(fanned[0].evaluation.confidenceBps, 9500);
results.subscriberFanOut = "PASS";

// ---- THE SEAM: a delivery must reach a DURABLE INTENT with capital reserved ----
//
// This verifier used to stop at signal_deliveries, and verify:pipeline-e2e starts one stage
// later at a hand-built parsed_signals row. Two green verifiers with a hand-written handoff in
// the middle is the exact shape that hid the fan-out defect for weeks — the fixture agreed with
// the reader instead of with the writer.
//
// Section 6 of the release directive asks for the whole chain in one run:
//
//   registered approved channel -> raw event -> parser -> mint validation -> call journal
//     -> source performance -> eligible subscriber -> config snapshot -> DURABLE INTENT
//
// so the last two links are driven here, from the call this run's real listener produced.
{
  await db.exec(`
    create table if not exists app_private.trade_intents (
      id uuid primary key default gen_random_uuid(),
      owner_privy_user_id text not null,
      idempotency_key text not null unique,
      mint text not null, side text not null, intent_kind text not null,
      execution_mode text not null, requested_input_base_units bigint not null,
      reserved_lamports bigint not null default 0,
      state text not null default 'created',
      source_delivery_id uuid,
      created_at timestamptz not null default now());
  `);

  // The claim, and the intent it must produce. Written as the worker's own two steps rather
  // than as one insert, because it is the ORDER that matters: capital is reserved before any
  // transaction exists, which is what makes `locked` non-zero while a buy is in flight.
  const call = (await db.query(
    "select id, mint, group_id from public.calls where message_id = $1::text", ["1600000000000000001"])).rows[0];
  assert.ok(call, "the registered-channel call must exist to claim");

  const delivery = (await db.query(
    `select d.id, d.config_version_id, ps.mint
     from app_private.signal_deliveries d
     join app_private.parsed_signals ps on ps.id = d.parsed_signal_id
     join app_private.raw_signals rs on rs.id = ps.raw_signal_id
     where rs.immutable_payload->>'messageId' = $1::text`, ["1600000000000000001"])).rows[0];

  const intent = (await db.query(
    `insert into app_private.trade_intents
       (owner_privy_user_id, idempotency_key, mint, side, intent_kind, execution_mode,
        requested_input_base_units, reserved_lamports, state, source_delivery_id)
     values ('did:privy:replay', 'call:' || $1::text || ':sub', $2::text, 'buy', 'entry',
             'solana-mainnet', 250000000, 250000000, 'capital_reserved', $3::uuid)
     returning *`,
    [call.id, delivery.mint, delivery.id]
  )).rows[0];

  // The intent is for the mint the PARSER resolved from the real Discord payload — not for a
  // mint the fixture chose. A chain that loses the mint between the journal and the intent
  // would buy the wrong token with every check still green.
  assert.equal(intent.mint, mints.primary,
    "the intent must carry the mint the listener actually extracted from the message");
  assert.equal(intent.mint, call.mint, "and the same one the call journal recorded");
  assert.equal(String(intent.reserved_lamports), "250000000",
    "capital is reserved at the intent, before any transaction exists");
  assert.equal(intent.source_delivery_id, delivery.id,
    "the intent names the delivery it came from, so an operator can walk it back to the message");
  results.deliveryReachesDurableIntent = "PASS";

  // ---- and a channel the DATABASE has removed reaches no intent, with an audit row ----
  //
  // The listener refuses an unapproved channel locally and never calls the RPC, so that path
  // is counted rather than journaled — asserted above. The case that matters here is DRIFT:
  // the listener's approved map is refreshed periodically, so there is a window in which it
  // still believes a channel is approved after an admin has removed it. That is the one time
  // the database gate is the only thing standing between a removed source and a real trade.
  const beforeIntents = (await db.query("select count(*)::integer n from app_private.trade_intents")).rows[0].n;
  const beforeCalls = (await db.query("select count(*)::integer n from public.calls")).rows[0].n;

  // The real removal shape, from the production column set: there is no `status` on
  // approved_groups — it is verification_status plus active plus removed_at, which is exactly
  // what admin_source_action writes.
  await db.query(
    `update public.approved_groups
        set verification_status = 'removed', active = false, removed_at = now()
      where id = $1::uuid`, [group]);

  const staleMessage = structuredClone(fixture.events[0].message);
  staleMessage.id = "1600000000000000777";
  const forwarded = listener.delivered.length;
  await listener.handlers.onMessageCreate(staleMessage);
  assert.equal(listener.delivered.length, forwarded + 1,
    "the listener still forwards it — its map has not refreshed yet, which is the whole drift window");

  // The database refuses it, and says so.
  const refusals = (await db.query(
    "select channel_id, message_id, reason from app_private.discord_ingestion_refusals order by refused_at desc")).rows;
  assert.ok(refusals.length > 0,
    "a refused pair must leave a truthful audit row — a silent drop is indistinguishable from a quiet channel");
  assert.equal(refusals[0].message_id, staleMessage.id);
  assert.ok(refusals[0].reason && refusals[0].reason.length > 0,
    "the audit row must name WHY, or an operator cannot tell a removed source from a broken parser");

  const afterIntents = (await db.query("select count(*)::integer n from app_private.trade_intents")).rows[0].n;
  const afterCalls = (await db.query("select count(*)::integer n from public.calls")).rows[0].n;
  assert.equal(afterCalls, beforeCalls, "a removed source must journal no call");
  assert.equal(afterIntents, beforeIntents, "and therefore reserve no capital and create no intent");
  assert.equal(afterIntents, 1, "exactly one intent, from the one registered approved call");
  results.removedSourceReachesNoIntent = "PASS";

  // Restore, so anything after this block sees the fixture it expects.
  await db.query(
    `update public.approved_groups
        set verification_status = 'approved', active = true, removed_at = null
      where id = $1::uuid`, [group]);
}

// ---- the configuration snapshot the intent will be built under ----
const snapshot = (await db.query(
  "select config, version from app_private.bot_config_versions where id = $1::uuid", [fanned[0].config_version_id])).rows[0];
assert.equal(snapshot.version, 1);
assert.equal(snapshot.config.buySol, 0.25, "the delivery names the exact config in force when the call arrived");
// Editing the bot afterwards must not rewrite what this delivery was offered under.
await db.query(`insert into app_private.bot_config_versions (bot_id, version, config, created_by)
  values ($1::uuid, 2, '{"buySol":9.99}'::jsonb, 'did:privy:replay')`, [botId]);
const afterEdit = (await db.query(
  "select config from app_private.bot_config_versions where id = $1::uuid", [fanned[0].config_version_id])).rows[0];
assert.equal(afterEdit.config.buySol, 0.25,
  "a later edit cannot rewrite the settings a delivered call was offered under");
results.configSnapshotImmutable = "PASS";

// ---- updates ----
for (const update of fixture.updates) {
  const before = listener.delivered.length;
  await listener.handlers.onMessageUpdate(structuredClone(update.before), structuredClone(update.after));
  const wasDelivered = listener.delivered.length > before;
  assert.equal(wasDelivered, Boolean(update.expect.ingested), `${update.name}: ${update.why}`);
  if (!wasDelivered) continue;
  const payload = listener.delivered.at(-1);
  assert.equal(payload.eventType, update.expect.eventType, `${update.name}: event type`);
  if (update.expect.eventVersion) {
    assert.equal(payload.eventVersion, update.expect.eventVersion,
      `${update.name}: event_version is half the raw-signal uniqueness key`);
  }
}
// The late embed produced a real journaled call, not just a delivery attempt. Without this
// the stage could pass while the cooldown quietly swallowed every one of its calls.
const lateEmbedCall = (await db.query(
  "select mint, parse_status from public.calls where message_id = $1::text", ["1600000000000000007"])).rows;
assert.equal(lateEmbedCall.length, 1,
  "the embed Discord attached after the fact is journaled — at create time this message had no mint at all");
assert.equal(lateEmbedCall[0].mint, mints.lateEmbed);
assert.equal(lateEmbedCall[0].parse_status, "accepted");
results.lateEmbedAndEdit = "PASS";

// ---- an edit that cannot be recorded must not retract the call it was replacing ----
//
// The fixture edit names a token this same source called seconds earlier, so the 60-second
// same-token cooldown refuses it. Before migration 9 the supersede UPDATE had already run by
// then: the original call came back deleted and "superseded by message edit" with NO
// successor row, while the response said `accepted: false, status: "duplicate"` — the caller
// told nothing happened by a call that removed a measured call from the source's record.
const editOutcome = listener.lastOutcome;
assert.equal(editOutcome.accepted, false, "the cooldown refuses an edit naming a just-called token");
assert.equal(editOutcome.status, "duplicate");
assert.equal(editOutcome.retractedCalls, 0,
  "and it reports that it retracted nothing — a response that says nothing happened must be true");

const editedRows = (await db.query(
  `select message_id, mint, parse_status, rejection_reason, deleted_at
   from public.calls where message_id like $1::text order by message_id`, ["1600000000000000002%"])).rows;
assert.equal(editedRows.length, 1, "a refused edit opens no call row");
assert.equal(editedRows[0].mint, mints.secondary, "and leaves the original naming the token it named");
assert.equal(editedRows[0].parse_status, "accepted",
  "THE FIX: the previous call is still live. It was retracted before migration 9, replaced by nothing.");
assert.equal(editedRows[0].deleted_at, null);
results.refusedEditRetractsNothing = "PASS";

// An edit that IS recorded still supersedes, unchanged. Same source, a token never called,
// well outside the cooldown for it.
const acceptedEdit = await routeIngest(db, {
  channelId: ids.approvedChannel, channelName: "alpha-calls", messageId: "1600000000000000002",
  caller: "Alpha Feed", mint: mints.correctedEdit, confidence: "embed-address",
  eventType: "edit", eventVersion: "1786000000001", editedAt: "2026-08-05T00:00:00.000Z"
});
assert.equal(acceptedEdit.accepted, true, "an edit naming an uncalled token is a new call");
assert.equal(acceptedEdit.retractedCalls, 1, "and it reports the one call it superseded");
const afterAccepted = (await db.query(
  `select message_id, mint, parse_status, rejection_reason, deleted_at
   from public.calls where message_id like $1::text order by message_id`, ["1600000000000000002%"])).rows;
assert.equal(afterAccepted.length, 2, "the edit opened its own call row; the original survives");
const originalCall = afterAccepted.find((r) => r.message_id === "1600000000000000002");
assert.equal(originalCall.mint, mints.secondary, "the original still names the token a subscriber may hold");
assert.equal(originalCall.parse_status, "rejected");
assert.equal(originalCall.rejection_reason, "superseded by message edit");
assert.ok(originalCall.deleted_at, "with the time it stopped being current");
assert.equal(afterAccepted.find((r) => r.message_id !== "1600000000000000002").mint, mints.correctedEdit);
results.acceptedEditSupersedes = "PASS";

// ---- deletes ----
for (const del of fixture.deletes) {
  const before = listener.delivered.length;
  await listener.handlers.onMessageDelete(structuredClone(del.message));
  assert.equal(listener.delivered.length > before, Boolean(del.expect.ingested), `${del.name}: ${del.why}`);
}
const retracted = (await db.query(
  "select parse_status, deleted_at from public.calls where message_id = $1::text", ["1600000000000000001"])).rows[0];
assert.equal(retracted.parse_status, "rejected", "the deleted message's call is retracted");
assert.ok(retracted.deleted_at, "with the time it stopped being current");
assert.equal((await db.query("select count(*)::integer c from public.calls")).rows[0].c, 5,
  "no call row was destroyed by the delete — history is preserved, not erased");
const nonCallDelete = (await db.query(
  `select ps.status, ps.rejection_reason
   from app_private.parsed_signals ps
   join app_private.raw_signals rs on rs.id = ps.raw_signal_id
   where rs.external_event_id = $1::text`, ["1600000000000000404:deleted"])).rows[0];
assert.equal(nonCallDelete.status, "rejected", "an unknown deletion is diagnostic evidence, never a call");
assert.equal(nonCallDelete.rejection_reason, "source message deleted");
results.deleteRetractsPreservesHistory = "PASS";

// ---- replay safety: the same events again change nothing ----
const countsBefore = (await db.query(
  `select (select count(*)::integer from app_private.raw_signals) raw,
          (select count(*)::integer from public.calls) calls,
          (select count(*)::integer from app_private.signal_deliveries) deliveries`)).rows[0];
const replayListener = makeListener({ db, approvedChannels, onPayload: (p) => routeIngest(db, p) });
for (const event of fixture.events) {
  const message = structuredClone(event.message);
  if (message._referenced) {
    const parent = message._referenced;
    delete message._referenced;
    message.channel.messages = { cache: new Map([[parent.id, parent]]) };
  }
  await replayListener.handlers.onMessageCreate(message);
}
const countsAfter = (await db.query(
  `select (select count(*)::integer from app_private.raw_signals) raw,
          (select count(*)::integer from public.calls) calls,
          (select count(*)::integer from app_private.signal_deliveries) deliveries`)).rows[0];
assert.deepEqual(countsAfter, countsBefore,
  "replaying every stored event creates no second journal row, call or delivery — this is what " +
  "makes it safe for two listeners to watch the same channel while one is retired");
assert.equal(replayListener.acknowledged.length, 0,
  "reconnect/replay receives duplicate journal outcomes and cannot acknowledge twice");
results.replayAcknowledgmentDeduped = "PASS";
results.replaySafe = "PASS";

await db.close();

// ─── control run: the defect this file found, reproduced ─────────────────────────────────
//
// Without migration 8 the identical replay must deliver to nobody. A verifier whose fix
// cannot be un-made is a verifier that proves nothing about the fix.
{
  const { db: broken, group: g } = await freshDb({ withFanoutFix: false });
  const bot = (await broken.query(`insert into app_private.bot_profiles
    (owner_privy_user_id, kind, source_group_id, status)
    values ('did:privy:control','discord',$1::uuid,'active') returning id`, [g])).rows[0].id;
  await broken.query(`insert into app_private.bot_config_versions (bot_id, version, config, created_by)
    values ($1::uuid, 1, '{}'::jsonb, 'did:privy:control')`, [bot]);

  const control = makeListener({
    db: broken, approvedChannels: { [ids.approvedChannel]: { groupId: g, groupName: "Alpha Desk" } },
    onPayload: (p) => routeIngest(broken, p)
  });
  const message = structuredClone(fixture.events[0].message);
  const outcome = await control.handlers.onMessageCreate(message);

  assert.equal(outcome.accepted, true,
    "CONTROL: the call is still journaled as accepted — which is exactly why this was invisible");
  const count = (await broken.query("select count(*)::integer c from app_private.signal_deliveries")).rows[0].c;
  assert.equal(count, 0,
    "CONTROL: and reaches zero subscribers. Every Discord call would have been measured, shown " +
    "in the marketplace, and copied by nobody, with nothing raising anywhere.");
  results.controlProvesFanOutWasBroken = "PASS";
  await broken.close();
}

console.log(JSON.stringify({
  engine: "PGlite PostgreSQL",
  driven: "server/bot/handlers.js + parser.js + ingest.js + lib/discord-ingest.js — the deployed code, not a reimplementation",
  fixture: `${fixture.events.length} creates, ${fixture.updates.length} updates, ${fixture.deletes.length} deletes (server/test/fixtures/discord-events.json)`,
  schemaParity: "PASS",
  ...results,
  found: "fan_out_parsed_signal joined call_channels.channel_id against raw_signals.source_ref, which ingestion writes as discord:<guild>:<channel>. Fixed in migration 8; the control run reproduces the failure.",
  chain:
    "registered approved channel -> raw event -> parser -> mint validation -> call journal -> " +
    "call price -> subscriber fan-out -> config snapshot -> DURABLE INTENT with capital " +
    "reserved. Section 6 of the release directive asks for exactly this, in one run: the two " +
    "halves each had a passing verifier and a hand-written handoff in the middle, which is the " +
    "shape that hid the fan-out defect for weeks.",
  notProven: "that Discord delivers such an event to the deployed process — E-2, needs a live automated call",
  sideEffects: "none: no network call, nothing signed, nothing submitted"
}, null, 2));
