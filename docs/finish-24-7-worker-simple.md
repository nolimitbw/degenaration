# The last 3 steps (for the 24/7 auto-trade worker)

Everything else is DONE. The website works right now. This file is ONLY for the
optional background worker that makes copy-trades fire while your laptop is off.

Claude already did 4 of the 6 Railway settings. These 3 are secret keys to your
own money, so ONLY YOU can paste them. Claude is not allowed to touch them.

Take your time. Do one box at a time. Nothing here can break the live website.

--------------------------------------------------------------------------------

## What you are doing (plain English)

You are copying 3 secret keys from 2 websites (Supabase, Privy) and pasting them
into a 3rd website (Railway). That's it. Copy, paste, copy, paste, copy, paste.

--------------------------------------------------------------------------------

## KEY 1 of 3 — Supabase service_role key

1. Go to:
   https://supabase.com/dashboard/project/uqccguunmjabjheeivhx/settings/api-keys/legacy
2. Find the row that says **service_role** with a red **secret** tag.
3. Click **Reveal**, then click the **copy** icon.
4. Now it's copied. Go do "PASTE IT" below with the name:  SUPABASE_SERVICE_KEY

--------------------------------------------------------------------------------

## KEY 2 of 3 — Privy app secret

1. Go to: https://dashboard.privy.io  -> click the **Degenaration** app -> **Basics**.
2. Scroll to **App secret**. Click **Reveal** / the copy icon.
   (If it says you already made the max number, click **New secret** to make one,
    and copy it the ONE time it shows.)
3. Paste it (see "PASTE IT") with the name:  PRIVY_APP_SECRET

--------------------------------------------------------------------------------

## KEY 3 of 3 — Privy authorization key

1. Same Privy app -> left menu **Wallet infrastructure** -> **Keys and quorums**.
2. Click **New key** (top right). Accept the defaults / create it.
3. It shows a private key **ONE TIME ONLY**. Copy it immediately.
4. Paste it (see "PASTE IT") with the name:  PRIVY_AUTHORIZATION_KEY

--------------------------------------------------------------------------------

## PASTE IT (where all 3 keys go — Railway)

1. Go to: https://railway.app  -> open the project **degenaration-worker**.
2. Click the service box, then the **Variables** tab.
3. Click **+ New Variable**.
4. First box = the NAME from above (e.g. SUPABASE_SERVICE_KEY).
   Second box = the key you copied. Click **Add**.
5. Repeat for all 3 keys.

When all 3 are in, Railway restarts the worker by itself. Done.

--------------------------------------------------------------------------------

## After all 3 are in

Tell Claude "the 3 keys are in" and Claude will check the Railway logs to confirm
the worker started cleanly. It will be in SAFE WATCH-ONLY mode (WORKER_NET=devnet,
DELEGATED_SIGNING=off) — it watches but does NOT trade yet, so nothing is at risk.
Going fully live (real trades) is a separate, deliberate step you approve later.
