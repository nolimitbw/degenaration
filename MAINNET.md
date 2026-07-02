# Going to Mainnet — the one-step flip (gated on safety)

The app is built so that switching from devnet to mainnet is a **single environment
variable change**. But do NOT flip it until the gates below are cleared — mainnet means
real money, and rushing it is how users lose funds and how you become personally liable.

## The flip (when ready)

In Vercel → Settings → Environment Variables, change:

    NEXT_PUBLIC_SOLANA_RPC_URL = https://your-mainnet-rpc   (Helius/QuickNode recommended)

Also set (server-side, so your 2% actually lands):

    PLATFORM_FEE_ACCOUNT = <your fee wallet's associated token account>
    SOLANA_RPC_URL       = https://your-mainnet-rpc          (used by server routes)

Then redeploy. That's it — the execution engine, fee logic, charts and data are already
mainnet-shaped (DexScreener data is already mainnet).

## Gates you must clear FIRST (do not skip)

1. **Execution tested on devnet.** Run real buys through the terminal on devnet with a
   funded Phantom wallet. Confirm: tx signs, sends, confirms; trade + fee record in the DB;
   TP/SL fire; failures are handled. [Execution loop is built — test it.]
2. **Fee wallet ready.** Create your fee wallet + its associated token account for the fee
   mint, set `PLATFORM_FEE_ACCOUNT`. Verify the 2% actually arrives on a test swap.
3. **Security review.** Independent review of the execution + permission model. A bug in an
   auto-trader drains wallets. Non-negotiable before real funds.
4. **Legal sign-off.** An auto-trading service that charges a fee touches regulated areas in
   most countries. Get a lawyer to review your ToS, risk disclosure, and whether you need to
   register. The 2% fee itself is a legitimate model (Trojan/BonkBot/Photon do it) — the point
   is doing it compliantly for your jurisdiction.
5. **Remove the devnet banner** and update copy to reflect live mainnet.

## Why the fee is fine

Charging 2% per trade is a standard, legitimate revenue model for on-chain trading tools.
It's transparent (shown before every trade), taken on-chain via Jupiter's platform-fee, and
only charged when a user actually trades. That's a real business — not a scam. The gates
above aren't about the fee; they're about handling other people's money safely and legally.
