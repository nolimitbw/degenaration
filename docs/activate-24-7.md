# Activate 24/7 auto-trading (10 minutes)

The whole app + engine are built and tested. These are the only steps left, and every one
needs a secret/account that only you can access. Do them in order. Test on DEVNET first.

---

## Step 1 — Create the database tables (2 min)

Open your Supabase project -> **SQL Editor** -> New query -> paste this -> **Run**:

```sql
create table if not exists public.limit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_pubkey text not null,
  wallet_id text,
  mint text not null,
  symbol text,
  trigger text not null check (trigger in ('below','above')),
  target_usd double precision not null,
  amount_sol double precision not null,
  slippage_bps int not null default 300,
  status text not null default 'open' check (status in ('open','filled','cancelled')),
  sig text, last_error text,
  created_at timestamptz default now(), filled_at timestamptz
);
alter table public.limit_orders enable row level security;
create policy "own limit orders" on public.limit_orders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.copy_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_pubkey text not null,
  wallet_id text,
  leader_wallet text not null,
  label text,
  size_sol double precision not null default 0.1,
  tp1 numeric default 2, tp1_sell int default 50,
  tp2 numeric default 5, tp2_sell int default 25,
  stop_loss int default 40,
  slippage_bps int not null default 300,
  daily_cap_sol double precision not null default 2,
  daily_spent double precision not null default 0,
  enabled boolean not null default true,
  created_at timestamptz default now(),
  unique (user_id, leader_wallet)
);
alter table public.copy_subscriptions enable row level security;
create policy "own copy subs" on public.copy_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

(This is the same block already appended to `supabase/schema.sql`. If you already ran the
older version of this block, also run `supabase/add-copy-subscription-tp-sl.sql` once to
add the tp1/tp2/stop_loss columns to your existing table.)
After this, creating a limit order or a copy-subscription in the app really saves to your DB.

---

## Step 2 — Turn on Privy delegated signing (3 min)

1. Privy dashboard -> your app -> **Wallets / Delegated actions (session signers)** -> enable.
2. Copy your **App secret** and create a **wallet-API authorization key**.
3. In the app (already built): users click **Enable auto-trading** on `/wallet` to grant the
   trade-only, capped, revocable delegation. Nothing else to code.

---

## Step 3 — Run the worker 24/7 (5 min, Railway free tier)

The worker (`server/worker.js`) is what runs when your Mac is off.

```bash
npm i -g @railway/cli
railway login                      # opens browser
cd server && railway init          # create a project
railway up                         # deploy the worker
```

Then in the Railway project **Variables**, set:

```
SUPABASE_URL=            (your project URL)
SUPABASE_SERVICE_KEY=    (Supabase -> Settings -> API -> service_role key)
MAINNET_RPC=             (optional paid RPC; blank = public)
PRIVY_APP_ID=            (from Privy)
PRIVY_APP_SECRET=        (from Privy)
PRIVY_AUTHORIZATION_KEY= (from Privy)
WORKER_NET=devnet        (start on devnet!)
DELEGATED_SIGNING=off    (keep OFF until the devnet test below passes)
```

---

## Step 4 — Devnet test, THEN go live

1. With `DELEGATED_SIGNING=off`, watch the Railway logs: the worker should log `[limit]` /
   `[copy]` triggers (watch-only, no trades). Confirms wiring + data flow.
2. Fund a devnet wallet, enable auto-trading, create a tiny limit order that will trigger.
3. Set `DELEGATED_SIGNING=on` (still `WORKER_NET=devnet`). Confirm it signs + a devnet tx
   lands. This is the ONE piece not verifiable without your Privy account — verify it here.
4. Only after that works: `WORKER_NET=mainnet`, start with tiny real amounts.

---

## What is already done (no action needed)

- Limit orders + copy subs save to Supabase (Privy wallet id attached).
- `/orders` create/cancel; terminal limit tab; tracker "Copy trades" control.
- Worker watchers (`limits.js`, `copy.js`) + delegated signer (`signer.js`) — tested logic.
- AutoTrade consent UI on `/wallet`. Non-custodial throughout; caps enforced.
