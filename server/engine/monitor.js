/**
 * Position monitor — watches open positions and fires TP/SL sells
 * according to each user's per-group settings.
 */
const { sellToken } = require("./jupiter");

const POLL_MS = 5_000;

/**
 * Tokens to sell for one take-profit level.
 *
 * `percent` is a share of the ORIGINAL position, never of what an earlier level left. The
 * API rejects tp1_sell + tp2_sell > 100 and the builder labels it "% allocated"; both are
 * meaningless unless the shares come out of the same whole. Capped at `remaining` so the
 * position can never go negative.
 */
function takeProfitShare(original, remaining, percent) {
  const wanted = Math.floor(original * (percent / 100));
  return Math.max(0, Math.min(remaining, wanted));
}

/**
 * positions: [{ userPubkey, mint, entryPriceUsd, amountRaw, settings:{ tp1,tp1sell,tp2,tp2sell,sl }, filled:{tp1:false,tp2:false} }]
 * getPrice(mint) -> current USD price (DexScreener)
 * submitSigned(tx, userPubkey) -> signs with user's delegated session key + sends
 */
/**
 * KNOWN GAP, and deliberately not patched here — see OPEN_BLOCKERS B-2.
 *
 * `submitSigned` resolves as soon as Privy SUBMITS the transaction; `signAndSend` in
 * signer.js returns `res.hash` without waiting for confirmation. This function then marks
 * `p.open = false` (or `filled.tpN = true`) immediately, so a sell that fails on chain -
 * slippage exceeded, blockhash expired, insufficient balance - is recorded as an exit that
 * happened. The position keeps falling with its stop-loss believed spent.
 *
 * Both obvious fixes are wrong on their own:
 *
 *   - Retry when unconfirmed: a sell that DID land but was slow to confirm gets sold twice.
 *   - Leave state untouched on error: the next 5s tick re-fires the same sell, same result.
 *
 * The correct shape is a pending state that blocks re-firing until the signature resolves
 * confirmed or failed, which needs the position to survive a restart. `positions` here is an
 * in-memory array with no persistence, so that is a design change rather than a patch, and
 * getting it wrong double-sells a user's position. It is written up rather than guessed at.
 */
function startMonitor({ positions, getPrice, submitSigned, onEvent }) {
  const tick = async () => {
    for (const p of positions.filter(x => x.open)) {
      try {
        const price = await getPrice(p.mint);
        if (!price) continue;
        const mult = price / p.entryPriceUsd;

        // Stop-loss: sell 100%
        if (mult <= 1 - p.settings.sl / 100) {
          const { tx } = await sellToken(p.mint, p.amountRaw, p.userPubkey, p.settings.slippageBps);
          await submitSigned(tx, p.userPubkey);
          p.open = false;
          onEvent({ type: "SL", position: p, mult });
          continue;
        }
        // Both take-profit percentages are fractions of the ORIGINAL position, never of
        // whatever is left. That is the contract the rest of the system states: the API
        // rejects tp1_sell + tp2_sell > 100, and the builder labels it "% allocated" — both
        // meaningless unless the two shares come out of the same whole.
        //
        // Computing TP2 from the post-TP1 remainder, as this used to, silently under-sells.
        // 50% + 50% on 1000 tokens sold 500 then 50% of the remaining 500, exiting 750 and
        // leaving the user holding 250 of a token they had configured to leave entirely.
        const original = p.originalAmountRaw != null ? p.originalAmountRaw : (p.originalAmountRaw = p.amountRaw);
        const share = (percent) => takeProfitShare(original, p.amountRaw, percent);

        // TP1: partial sell (tp1 is stored as percentage, e.g. 200 for 2x)
        if (!p.filled.tp1 && mult >= p.settings.tp1 / 100) {
          const amt = share(p.settings.tp1sell);
          if (amt > 0) {
            const { tx } = await sellToken(p.mint, amt, p.userPubkey, p.settings.slippageBps);
            await submitSigned(tx, p.userPubkey);
            p.amountRaw -= amt;
          }
          p.filled.tp1 = true;
          onEvent({ type: "TP1", position: p, mult });
        }
        // TP2: partial sell (tp2 is stored as percentage, e.g. 500 for 5x)
        if (!p.filled.tp2 && mult >= p.settings.tp2 / 100) {
          const amt = share(p.settings.tp2sell);
          if (amt > 0) {
            const { tx } = await sellToken(p.mint, amt, p.userPubkey, p.settings.slippageBps);
            await submitSigned(tx, p.userPubkey);
            p.amountRaw -= amt;
          }
          p.filled.tp2 = true;
          onEvent({ type: "TP2", position: p, mult });
        }
      } catch (e) {
        onEvent({ type: "ERROR", position: p, error: e.message });
      }
    }
    setTimeout(tick, POLL_MS);
  };
  tick();
}

module.exports = { startMonitor, takeProfitShare };
