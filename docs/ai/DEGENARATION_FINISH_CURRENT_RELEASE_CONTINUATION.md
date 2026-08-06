# DEGENARATION — FINISH THE CURRENT RELEASE WITHOUT RESTARTING

Continue the CURRENT active goal, branch, working tree, commits, Vercel deployment, Supabase project, Railway bot, Railway worker, authenticated browser session, and existing evidence.

This is not a new project, new plan, or new audit. Do not restart, rescan the whole repository, repeat completed work, call Codex, launch parallel/dynamic workflows, or write long progress summaries.

Current verified production state:

- Vercel app is deployed.
- Railway bot is deployed.
- Railway worker is deployed but watch-only.
- Registered-channel authorization exists.
- The builder has switches.
- The capital formula is implemented.
- Production still cannot RUN because delegated signing/mainnet execution readiness is incomplete.
- Remaining UI, trading behavior, revenue administration, and acceptance work are not complete.

Continue immediately from this state.

## 1. COMPLETE THE EXECUTION WORKER AND SIGNER

The owner authorizes all reversible configuration and deployment work required to make the execution stack ready.

On the existing Railway `degenaration-worker` production service:

1. Verify the currently deployed worker SHA.
2. Verify `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `PRIVY_AUTHORIZATION_KEY` exist without printing them.
3. Set `DELEGATED_SIGNING=on`.
4. Redeploy the same verified worker source.
5. Verify `/health` reports:
   - worker healthy;
   - signer configured;
   - no secret values;
   - no fatal configuration errors;
   - trading still protected by subscription state, mainnet activation, and canary controls.
6. Verify signer policy binds:
   - correct user;
   - correct Privy wallet;
   - exact intent;
   - expected mint and programs;
   - amount;
   - slippage;
   - priority fee;
   - expiry;
   - reservation;
   - replay/idempotency key.
7. Do not use client funds or broadcast a funded transaction automatically.

Complete the worker implementation for every internally solvable function:

- durable job claim and lease;
- lease renewal/recovery;
- capital reservation;
- fresh quote;
- quote expiration;
- pre-submit simulation;
- bounded retries;
- cooldown;
- entry limits;
- DCA placement;
- TP;
- SL;
- trailing TP;
- trailing SL;
- dynamic/delayed/freeze stop behavior;
- pause;
- resume;
- exit-only;
- emergency stop;
- signature persistence;
- confirmation;
- settlement;
- reconciliation;
- Portfolio/performance updates.

Do not leave controls declared but unenforced.

## 2. COMPLETE THE PLATFORM FEE SYSTEM

The platform fee is 2% and must be based only on eligible confirmed execution.

Correct the current zero-fee fallback.

Determine the exact Jupiter-compatible output-mint token account required by production.

Implement and verify:

- quote preview and charged fee use one authoritative function;
- no fee on failed/unconfirmed trades;
- no duplicate fee;
- fee persisted immutably;
- creator/referral allocation occurs only after confirmation;
- client principal is never mixed with platform revenue;
- reconciliation proves total allocations equal the confirmed fee.

When an Associated Token Account must be created on-chain, prepare the exact owner transaction and report once:

- owner wallet;
- mint;
- derived ATA;
- estimated rent/network cost;
- transaction purpose;
- rollback/disable procedure.

Do not choose an arbitrary wallet or sign it without final owner approval.

## 3. ADD ADMIN REVENUE AND FEE WITHDRAWAL

Add a server-restricted `Revenue` section to Admin Console.

Show real confirmed data, grouped per token/mint where necessary:

- platform fees today;
- 7D;
- 30D;
- lifetime;
- pending/unconfirmed fees;
- confirmed but allocated creator rewards;
- confirmed but allocated referral rewards;
- DegenAration net revenue;
- available-to-withdraw revenue;
- reserved/network-fee amount;
- withdrawn revenue;
- failed withdrawals;
- revenue history;
- transaction signatures and confirmation state;
- reconciliation warnings.

Do not combine unrelated tokens into one fake balance. A USD estimate may be shown separately with timestamp/source.

Add `Withdraw fees`.

This button must withdraw only DegenAration-owned confirmed platform revenue, never client principal, client balances, locked capital, creator rewards, or referral rewards.

Required withdrawal flow:

1. Admin authentication checked server-side.
2. Select token/mint.
3. Show available balance.
4. Enter amount or use Max after reserving network fees.
5. Show destination owner wallet.
6. Show estimated network fee.
7. Show exact post-withdraw balance.
8. Require explicit confirmation.
9. Create an immutable idempotent revenue-withdrawal intent.
10. Sign through the approved owner/signing boundary.
11. Persist signature before confirmation polling.
12. Confirm on-chain.
13. Reconcile revenue ledger.
14. Update Admin history.
15. Prevent duplicate submission.

Never add arbitrary balance editing.

## 4. SIMPLIFY THE CLIENT BOT SETTINGS

Rebuild Discord and KOL setup so the first screen is simple and Mizar-familiar.

### Basic settings shown immediately

Only show these primary controls first:

1. `Buy amount`
2. `Take profit` — On by default using the project’s validated safe default
3. `Add take profit` — add/remove multiple TP levels
4. `Stop loss` — On by default using the project’s validated safe default
5. `Auto re-entry` — Off by default and placed directly below Stop loss

Each On/Off control must:

- clearly say On or Off;
- reveal its fields only when On;
- hide and semantically disable its fields when Off;
- not require users to fill disabled settings;
- preserve the last valid values for later re-enabling;
- exclude disabled values from capital calculation, validation, config snapshots, intents, and worker execution;
- save and reload exactly on edit;
- work on keyboard/mobile.

### Optional settings below

Place all advanced settings in a collapsed `Optional settings` section:

- DCA;
- trailing TP;
- trailing SL;
- daily spend limit;
- daily loss limit;
- maximum capital;
- maximum open trades;
- per-token exposure;
- liquidity;
- market cap;
- token age;
- holder/concentration checks;
- mint/freeze authority;
- blacklist/security checks;
- slippage;
- priority fee;
- quote expiration;
- retries;
- cooldown;
- scheduled scanning;
- KOL triggers;
- emergency stop.

Recommended safety filters may be On by default but must require no manual input unless expanded.

Use concise labels, info buttons, compact sections, and no walls of text.

## 5. REPLACE THE FINAL ACTIONS

Remove these final user-facing actions/messages:

- `Configuration passes client validation. Server and scanner checks still apply.`
- `Activation needs trading enabled`
- `Activation needs the execution worker`
- `Review and save draft`

Replace the final actions with exactly:

- `RUN`
- `Save and use later`

### RUN behavior

`RUN` must perform a server-side readiness transaction:

- authenticated user;
- owned wallet;
- approved source/strategy;
- registered approved Discord channel when applicable;
- valid saved configuration;
- sufficient available capital;
- worker healthy;
- signer configured;
- correct fee token account;
- mainnet/canary policy ready;
- no emergency stop;
- no duplicate active bot.

When all checks pass:

- save/version config;
- activate subscription;
- create/confirm worker eligibility;
- set state to `Active`;
- show the active bot in My Bots/Bot Manager;
- begin listening for eligible future calls.

When a genuine check fails, do not show vague text. Show one precise fixable reason next to RUN.

### Save and use later behavior

- save as `Draft`;
- do not create trade intents;
- do not reserve funds;
- allow edit/delete/archive;
- preserve exact settings.

Supported bot states:

- Draft;
- Validated;
- Ready;
- Active;
- Paused;
- Exit-only;
- Error;
- Archived.

## 6. REGISTERED-CHANNEL DISCORD SCANNER

Verify production end-to-end.

Only active guild/channel pairs registered and approved in the production database may create calls.

Support:

- human messages;
- third-party bot messages;
- webhook messages;
- embed-only calls;
- embed title/description/fields/author/footer/URL;
- buttons and action rows;
- attachments;
- replies;
- edits;
- preserved deletions;
- Discord partial objects.

Ignore only DegenAration’s own messages.

Extract and validate Solana CA/mint from all supported fields. Never guess ambiguous addresses.

Prove:

registered approved channel
→ raw event
→ parser
→ mint validation
→ scanner
→ call journal
→ source performance
→ eligible subscriber
→ config snapshot
→ durable intent.

Unregistered, removed, rejected, and disabled channels must produce no call or intent and must record a truthful audit reason.

Retire the duplicate legacy `degencalls` Render listener after Railway is verified authoritative. If access is unavailable, state one exact owner action once.

## 7. FINISH THE REMAINING PRODUCT

Complete and production-verify:

- Mizar-familiar Discord builder/edit;
- Mizar-familiar KOL builder/edit;
- Discord marketplace/source profiles;
- call performance and journal;
- My Bots/Bot Manager;
- Affiliate;
- Portfolio;
- winning PnL card;
- losing PnL card;
- Portfolio PnL card;
- Admin Console including Revenue.

Use existing reference inventory, parity matrix, click-flow map, screenshots, and videos. Do not rescan unchanged media.

Keep original DegenAration black/gold/white branding. No emojis, generic AI cards, fake covers, random polygons, oversized empty panels, or walls of text.

## 8. TEST, COMMIT, DEPLOY, VERIFY

For each milestone:

1. targeted tests;
2. formatter/lint/strict typecheck;
3. full `npm run check`;
4. production build;
5. financial invariant tests;
6. Discord replay/authorization tests;
7. worker tests;
8. authenticated browser checks at 390/768/1024/1440;
9. descriptive commit;
10. deploy exact SHA to Vercel/Railway/Supabase;
11. verify `/api/build`, listener heartbeat, worker health, and production UI;
12. continue.

Do not finish with local code or documentation only.

## FINAL MAINNET GATE

After all internally solvable work is complete, present one final controlled canary approval package:

- Vercel SHA;
- bot SHA;
- worker SHA;
- Supabase versions;
- signer status;
- fee account status;
- selected owner-controlled wallet;
- selected high-liquidity pair;
- maximum test amount;
- slippage;
- TP/SL;
- expected 2% fee;
- emergency-stop and rollback steps;
- confirmation that no client funds will be used.

Wait for explicit owner approval before the funded canary.

Do not enable all clients until the owner-controlled canary enters, confirms, settles, exits, charges the correct fee, reconciles, and updates Portfolio successfully.

Continue now. Do not stop for a summary, another plan, or another owner question until one irreversible action is genuinely required.
