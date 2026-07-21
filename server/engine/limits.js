/**
 * Limit-order watcher (server side). Polls prices for open limit orders and executes
 * a buy when the target is hit. Execution is non-custodial: the user's DELEGATED session
 * key signs via the injected signAndSend(tx, userPublicKey). We never hold keys.
 */
const { buyToken } = require("./jupiter");

// Pure, testable: is this order's price condition met?
function evaluateLimit(order, price) {
  if (!price || order.status !== "open") return false;
  return order.trigger === "below" ? price <= order.target_usd : price >= order.target_usd;
}

/**
 * deps:
 *  loadOpenOrders() -> [{ id, user_pubkey, mint, symbol, trigger, target_usd, amount_sol, slippage_bps }]
 *  getPrice(mint) -> number|null
 *  signAndSend(base64Tx, userPubkey) -> signature   (Privy delegated key)
 *  claimOrder(id) / finishOrder(id, token, status, sig, error)
 *  recordTrade(evt) / onEvent(evt)
 */
function startLimitWatcher(deps, pollMs = 8000) {
  const { loadOpenOrders, getPrice, signAndSend, claimOrder, finishOrder, recordTrade = async () => {}, onEvent = () => {} } = deps;
  const inflight = new Set();

  const runTick = async () => {
    let orders = [];
    try { orders = await loadOpenOrders(); } catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); }
    // price once per unique mint
    const priceByMint = {};
    for (const mint of [...new Set(orders.map((o) => o.mint))]) priceByMint[mint] = await getPrice(mint);
    for (const o of orders) {
      const price = priceByMint[o.mint];
      if (!evaluateLimit(o, price) || inflight.has(o.id)) continue;
      inflight.add(o.id);
      let claimed;
      try { claimed = await claimOrder(o.id); }
      catch (e) { inflight.delete(o.id); onEvent({ type: "CLAIM_ERROR", order: o, error: e.message }); continue; }
      if (!claimed?.ok || !claimed?.claim_token) {
        inflight.delete(o.id);
        onEvent({ type: "CLAIM_SKIPPED", order: o, error: claimed?.error || "order unavailable" });
        continue;
      }
      const order = { ...o, ...(claimed.order || {}) };
      let sig = null;
      try {
        const { tx } = await buyToken(order.mint, order.amount_sol, order.user_pubkey, order.slippage_bps || 300);
        sig = await signAndSend(tx, order.wallet_id); // walletId signs; user_pubkey built the tx
        const finished = await finishOrder(order.id, claimed.claim_token, "filled", sig, null);
        if (!finished?.ok) throw new Error(finished?.error || "could not persist filled order");
        try {
          await recordTrade({ mint: order.mint, user: order.user_pubkey, privy_user_id: order.privy_user_id, size: order.amount_sol, sig, kind: "limit" });
        } catch (e) {
          onEvent({ type: "RECORD_ERROR", order, sig, error: e.message });
        }
        onEvent({ type: "FILLED", order, price, sig });
      } catch (e) {
        if (!sig) {
          try { await finishOrder(order.id, claimed.claim_token, "failed", null, e.message); }
          catch (finishError) { onEvent({ type: "FINISH_ERROR", order, error: finishError.message }); }
        }
        onEvent({ type: sig ? "PERSIST_ERROR" : "EXEC_ERROR", order, sig, error: e.message });
      } finally {
        inflight.delete(o.id);
      }
    }
  };
  const tick = async () => {
    try { await runTick(); }
    catch (e) { onEvent({ type: "TICK_ERROR", error: e.message }); }
    finally { setTimeout(tick, pollMs); }
  };
  tick();
}

module.exports = { evaluateLimit, startLimitWatcher };
