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
 *  onEvent(evt)
 */
function startLimitWatcher(deps, pollMs = 8000) {
  const { loadOpenOrders, getPrice, signAndSend, markFilled, markError, onEvent = () => {} } = deps;
  const inflight = new Set();

  const tick = async () => {
    let orders = [];
    try { orders = await loadOpenOrders(); } catch (e) { onEvent({ type: "LOAD_ERROR", error: e.message }); }
    // price once per unique mint
    const priceByMint = {};
    for (const mint of [...new Set(orders.map((o) => o.mint))]) priceByMint[mint] = await getPrice(mint);

    for (const o of orders) {
      const price = priceByMint[o.mint];
      if (!evaluateLimit(o, price) || inflight.has(o.id)) continue;
      inflight.add(o.id);
      try {
        const { tx } = await buyToken(o.mint, o.amount_sol, o.user_pubkey, o.slippage_bps || 300);
        const sig = await signAndSend(tx, o.wallet_id); // walletId signs; user_pubkey built the tx
        await markFilled(o.id, sig);
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
