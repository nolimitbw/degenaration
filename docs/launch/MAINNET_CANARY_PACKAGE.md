# Owner-controlled mainnet canary package

Status: **NOT AUTHORIZED — do not sign or broadcast**

This package is deliberately incomplete until the external runtime and owner-controlled
wallet exist. Missing values must be read back from the live worker and owner at approval
time; they must never be guessed from screenshots or repository history.

| Field | Canary value / gate |
|---|---|
| Owner-controlled wallet | **OWNER REQUIRED** — exact Privy/Solana address used for this canary |
| Approved source | SLPR DEGEN — guild `1495795490657275914`, channel `1495930481018142801` (`┃free-solana-degen`), read back from production on 2026-08-09 and to be re-verified before activation |
| High-liquidity pair | SOL/USDC — wSOL `So11111111111111111111111111111111111111112`, USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`; verify the selected Jupiter route immediately before approval |
| Entry amount | 0.01 SOL |
| Maximum daily funds | 0.01 SOL; one entry only |
| Take profit | +5%, sell 100% |
| Stop loss | -3%, sell 100% |
| Re-entry | Off |
| Slippage | 100 bps maximum |
| Expected platform fee | 200 bps on each confirmed swap leg; 0.0002 SOL-equivalent on a 0.01 SOL leg before route/rounding effects. The live fee account must be verified first |
| App SHA | Read `/api/build` immediately before approval; checkpoint `632b767` |
| Bot SHA | **RUNTIME REQUIRED** — exact `/health` SHA from the OCI Discord service |
| Worker SHA | **RUNTIME REQUIRED** — exact `/health` SHA from the OCI execution worker |
| Database state | Migrations through production migration 29; re-list immediately before approval |

## Preconditions

1. Deploy the OCI services and prove stable HTTPS health, Gateway readiness, approved-channel
   refresh, worker lease, all execution capabilities, and mainnet network identity.
2. Verify the app, bot, and worker SHAs are the reviewed artifacts.
3. Verify the fee account for the output mint and the 200 bps preview/charge agreement.
4. Confirm zero stale unreconciled executions and that emergency stop refuses new entries
   while preserving exits.
5. Obtain explicit owner approval naming the wallet and accepting this exact canary.

## Emergency stop and rollback

- Set the global mainnet-entry release gate off and the canary bot emergency stop on.
- Preserve the worker's exit monitor; do not disable TP/SL or abandon a submitted signature.
- Reconcile every submitted signature to confirmed, failed, expired, or manual-review state.
- Keep the immutable signal, intent, execution, fee, creator, referral, and reconciliation
  journals intact.
- Roll the OCI services back atomically to the prior release directory. Do not retire the
  previous host until the replacement has passed the full verification window.

After owner approval, verify the complete path specified in the master prompt. Any failed
invariant stops further entries before another user is enabled.
