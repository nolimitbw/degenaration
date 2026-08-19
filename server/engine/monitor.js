/**
 * Position monitor — fires each subscriber's take-profit and stop-loss sells.
 *
 * This is what makes a configured exit real. Positions are read from the database on
 * every tick (they used to live in an in-memory array that nothing ever filled, so a
 * restart forgot every open trade and no exit ever ran), and each leg is claimed before
 * it is sold, so two ticks or two workers cannot sell the same tokens twice.
 *
 * Thresholds, in the units the database actually stores:
 *   tp1 / tp2   price MULTIPLES of entry (2 = 2x). NOT percentages.
 *   stop_loss   percent DROP from entry (40 = sell at -40%, i.e. 0.6x).
 */
const { sellToken: jupiterSellToken } = require("./jupiter");

const POLL_MS = 5_000;

const positive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/**
 * Which exit legs a position has reached at this price, most protective first.
 * Pure and testable — this is the decision the money turns on.
 */
function dueExits(position, price) {
  const entry = positive(position.entry_price_usd);
  const current = positive(price);
  if (!entry || !current || !positive(position.amount_raw)) return [];

  const multiple = current / entry;
  const legs = [];

  // Stop-loss wins outright. With a sane ladder (tp1 above 1x) a position cannot be below
  // its stop and above a take-profit at once, but a tp1 set at or below 1x — an old row,
  // or a direct database edit — makes both true, and there the whole position must come
  // out rather than a partial being taken on the way down.
  const stop = Number(position.stop_loss);
  if (Number.isFinite(stop) && stop > 0 && stop < 100 && multiple <= 1 - stop / 100) {
    return [{ leg: "sl", multiple }];
  }

  const tp1 = positive(position.tp1);
  if (!position.filled_tp1 && tp1 && multiple >= tp1) legs.push({ leg: "tp1", multiple });

  const tp2 = positive(position.tp2);
  if (!position.filled_tp2 && tp2 && multiple >= tp2) legs.push({ leg: "tp2", multiple });

  return legs;
}

/**
 * deps:
 *  loadOpenPositions() -> [{ id, mint, user_pubkey, wallet_id, entry_price_usd, amount_raw,
 *                            tp1, tp1_sell, tp2, tp2_sell, stop_loss, slippage_bps,
 *                            filled_tp1, filled_tp2 }]
 *  getPrice(mint) -> current USD price
 *  claimPositionExit(positionId, leg, multiple) / finishPositionExit(...)
 *  touchPosition(positionId, price)
 *  signAndSend(tx, walletId) -> signature
 *  recordTrade(evt) / onEvent(evt)
 */
async function runExitTick(deps) {
  const {
    loadOpenPositions, getPrice, claimPositionExit, finishPositionExit,
    touchPosition = async () => {}, signAndSend, recordTrade = async () => {}, onEvent = () => {},
    // Injectable so the exit path can be tested without quoting against live Jupiter.
    sellToken = jupiterSellToken
  } = deps;

  let positions = [];
  try { positions = await loadOpenPositions(); }
  catch (e) { onEvent({ type: "POSITION_LOAD_ERROR", error: e.message }); return; }

  for (const position of positions || []) {
    if (!position?.id || !position.mint) continue;
    try {
      const price = await getPrice(position.mint);
      // No price is NOT a crash to zero. Skipping is the only safe reading of silence —
      // treating it as 0 would dump every position the moment a price feed hiccups.
      if (!positive(price)) { onEvent({ type: "PRICE_MISSING", position: position.id, mint: position.mint }); continue; }

      try { await touchPosition(position.id, price); } catch { /* bookkeeping only */ }

      for (const { leg, multiple } of dueExits(position, price)) {
        let claim;
        try { claim = await claimPositionExit(position.id, leg, multiple); }
        catch (e) { onEvent({ type: "EXIT_CLAIM_ERROR", position: position.id, leg, error: e.message }); continue; }
        if (!claim?.ok || !claim?.claim_token) {
          onEvent({ type: "EXIT_SKIPPED", position: position.id, leg, error: claim?.error || "exit unavailable" });
          continue;
        }

        let sig = null;
        try {
          const { tx } = await sellToken(claim.mint, claim.amount_raw, claim.user_pubkey, claim.slippage_bps || 300);
          sig = await signAndSend(tx, claim.wallet_id);
          const finished = await finishPositionExit(position.id, leg, claim.claim_token, "succeeded", sig, null);
          if (!finished?.ok) throw new Error(finished?.error || "could not persist exit");
          try {
            await recordTrade({
              mint: claim.mint, user: claim.user_pubkey, privy_user_id: claim.privy_user_id,
              side: "sell", sig, kind: `exit:${leg}`
            });
          } catch (e) {
            onEvent({ type: "EXIT_RECORD_ERROR", position: position.id, leg, sig, error: e.message });
          }
          onEvent({ type: leg === "sl" ? "STOP_LOSS" : leg.toUpperCase(), position: position.id, mint: claim.mint, multiple, sig });
        } catch (e) {
          // Only release the claim when nothing was sent. If a signature exists the sell
          // may well have landed, and retrying it would sell the same tokens twice.
          if (!sig) {
            try { await finishPositionExit(position.id, leg, claim.claim_token, "failed", null, e.message); }
            catch (finishError) { onEvent({ type: "EXIT_FINISH_ERROR", position: position.id, leg, error: finishError.message }); }
          }
          onEvent({ type: sig ? "EXIT_PERSIST_ERROR" : "EXIT_ERROR", position: position.id, leg, sig, error: e.message });
          break; // stop working this position; the next tick re-reads its true state
        }
      }
    } catch (e) {
      onEvent({ type: "POSITION_ERROR", position: position.id, error: e.message });
    }
  }
}

function startMonitor(deps, pollMs = POLL_MS) {
  const tick = async () => {
    try { await runExitTick(deps); }
    catch (e) { deps.onEvent?.({ type: "EXIT_TICK_ERROR", error: e.message }); }
    finally { setTimeout(tick, pollMs); }
  };
  tick();
}

module.exports = { dueExits, runExitTick, startMonitor };
