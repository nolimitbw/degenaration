/**
 * Ingestion delivery policy for the Discord bot.
 *
 * Split out of index.js because it is the part that can be tested without a gateway
 * connection. index.js owns the Discord wiring; this file owns the decisions.
 *
 * The defect it exists to close: the previous bot posted to /api/ingest-call once, and on
 * any failure logged the message and moved on. A confirmed call detected in an approved
 * channel could therefore be lost permanently because of a five-second network blip, and
 * nothing anywhere would record that it had happened. The route already returns 503 for
 * "mint validation temporarily unavailable" — a purely transient RPC condition — so the
 * single-attempt path was dropping real calls on the most ordinary failure it has.
 */

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * What to do about a failed delivery.
 *
 *   retry  — transient. The same payload will probably succeed shortly.
 *   reject — permanent and expected. The payload is not a call the server will accept
 *            (not a mint, channel not approved). Retrying cannot change the answer.
 *   fatal  — permanent and NOT expected. Credentials or configuration are wrong; every
 *            other call will fail the same way, so this must be loud rather than counted.
 */
function classifyDeliveryFailure({ status, networkError } = {}) {
  if (networkError) return "retry";
  if (typeof status !== "number") return "retry";
  if (RETRYABLE_STATUS.has(status)) return "retry";
  if (status === 401 || status === 403) return "fatal";
  if (status >= 400 && status < 500) return "reject";
  return "retry";
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

/**
 * Backoff for attempt N (0-based), before jitter.
 *
 * Jitter is applied by the caller rather than here so this stays deterministic and
 * therefore testable. A backoff schedule that cannot be asserted is a backoff schedule
 * that silently becomes a hot loop.
 */
function nextBackoffMs(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0) return BASE_DELAY_MS;
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}

/**
 * The exact body /api/ingest-call expects.
 *
 * eventVersion is load-bearing: it is half of the raw_signals uniqueness key
 * (message_id + ':' + event_version), so it is what lets one message be journaled as a
 * create and again as an edit without either overwriting the other. The route rejects an
 * empty one for edits and deletes, so it is built here rather than defaulted there.
 */
function buildIngestPayload({ guildId, channelId, channelName, messageId, caller, call, rejectionReason, eventType = "create", eventVersion, editedAt }) {
  const version = eventVersion || (eventType === "create" ? "original" : null);
  if (!version) throw new Error(`event version required for ${eventType}`);
  return {
    // The guild the message actually came from, checked against the registration server-side.
    // Null is accepted rather than refused: it is what a build predating this field sends, and
    // the gate records that it could not compare rather than treating it as a match.
    guildId: guildId || null,
    channelId,
    channelName: channelName || null,
    messageId,
    caller: caller || null,
    mint: call?.mint || null,
    confidence: call?.confidence || null,
    candidateType: call?.candidateType || null,
    rejectionReason: rejectionReason || null,
    eventType,
    eventVersion: String(version).slice(0, 64),
    editedAt: editedAt || null
  };
}

/**
 * Bounded dead-letter store.
 *
 * Deliveries that exhausted their retries are kept here so the operator can see that a
 * call was detected and not recorded, which is otherwise invisible. It is intentionally
 * in-memory and bounded: the alternative — writing to the database — needs the very
 * connection that just failed, and an unbounded list turns a provider outage into an
 * out-of-memory crash. Durability comes from the structured log line emitted alongside,
 * which carries the whole payload and can be replayed.
 */
class DeadLetterQueue {
  constructor(limit = 200) {
    this.limit = limit;
    this.entries = [];
    this.dropped = 0;
    this.total = 0;
  }

  add(entry) {
    this.total += 1;
    this.entries.push(entry);
    while (this.entries.length > this.limit) {
      this.entries.shift();
      this.dropped += 1;
    }
    return this;
  }

  get size() {
    return this.entries.length;
  }

  summary() {
    return { held: this.entries.length, retired: this.dropped, total: this.total };
  }
}

module.exports = {
  classifyDeliveryFailure,
  nextBackoffMs,
  buildIngestPayload,
  DeadLetterQueue,
  BASE_DELAY_MS,
  MAX_DELAY_MS
};
