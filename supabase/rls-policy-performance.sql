drop policy if exists "own profile read" on public.profiles;
drop policy if exists "own profile write" on public.profiles;
alter policy "own profile" on public.profiles
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "own journal select" on public.journal_entries;
alter policy "own journal write" on public.journal_entries
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "own snapshots" on public.wallet_pnl_snapshots
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "own daily pnl" on public.daily_pnl
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "own subs" on public.subscriptions
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "own trades read" on public.trades
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "own limit orders" on public.limit_orders
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "own copy subs" on public.copy_subscriptions
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
