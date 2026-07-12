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
 *  markFilled(id, sig) / markError(id, msg)          (persist result, e.g. Supabase)
 *  recordTrade(evt) / onEvent(evt)
 */
function startLimitWatcher(deps, pollMs = 8000) {
  const { loadOpenOrders, loadProfileCaps = async () => [], getPrice, signAndSend, markFilled, markError, recordTrade = async () => {}, onEvent = () => {} } = deps;
  const inflight = new Set();

  const tick = async () => {
    let orders = [];
    try { orders = await loadOpenOrders(); } catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); }
    // price once per unique mint
    const priceByMint = {};
    for (const mint of [...new Set(orders.map((o) => o.mint))]) priceByMint[mint] = await getPrice(mint);
    // per-user max-per-trade cap, fetched once per pubkey per tick.
    // -1 signals a fetch error (trade rejected), null means no cap configured.
    const capByUser = {};
    async function maxTrade(pubkey) {
      if (!(pubkey in capByUser)) {
        try { const r = await loadProfileCaps(pubkey); capByUser[pubkey] = r?.[0]?.max_trade_sol ?? null; }
        catch (e) { capByUser[pubkey] = -1; onEvent({ type: "CAP_LOAD_ERROR", pubkey, error: e.message }); }
      }
      return capByUser[pubkey];
    }

    for (const o of orders) {
      const price = priceByMint[o.mint];
      if (!evaluateLimit(o, price) || inflight.has(o.id)) continue;
      // Safety cap: never execute a single order larger than the user's configured max per trade.
      const cap = await maxTrade(o.user_pubkey);
      if (cap === -1) { await markError(o.id, "could not load trade cap"); onEvent({ type: "CAP_LOAD_FAILED", order: o }); continue; }
      if (cap != null && o.amount_sol > cap) { await markError(o.id, `amount ${o.amount_sol} exceeds max-per-trade ${cap}`); onEvent({ type: "CAP", order: o, cap }); continue; }
      inflight.add(o.id);
      try {
        const { tx } = await buyToken(o.mint, o.amount_sol, o.user_pubkey, o.slippage_bps || 300);
        const sig = await signAndSend(tx, o.wallet_id); // walletId signs; user_pubkey built the tx
        await markFilled(o.id, sig);
        await recordTrade({ mint: o.mint, user: o.user_pubkey, privy_user_id: o.privy_user_id, size: o.amount_sol, sig, kind: "limit" });
        onEvent({ type: "FILLED", order: o, price, sig });
      } catch (e) {
        await markError(o.id, e.message);
        onEvent({ type: "EXEC_ERROR", order: o, error: e.message });
      } finally {
        inflight.delete(o.id);
      }
    }
    setTimeout(tick, pollMs);
  };
  tick();
}

module.exports = { evaluateLimit, startLimitWatcher };
