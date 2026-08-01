-- S-1: stop exposing raw Discord message bodies and pipeline internals on `public.calls`.
--
-- NOT YET APPLIED. Review, then run. Reversible — the rollback is at the bottom.
--
-- THE PROBLEM
-- `public.calls` has policy `USING (true)` for role `public`, and `anon` holds table-wide
-- SELECT. RLS is row-level, so a row-permissive policy exposes EVERY column. Anyone with
-- the publishable key (which ships in the client bundle by design) can read the lot.
--
-- Public call *performance* is intentional — the marketplace ranks communities on it. The
-- rest is not, and was never a decision; it is simply what a table-wide grant does.
--
-- WHAT THE APP ACTUALLY READS
-- Verified against every reader rather than assumed: `app/api/calls`,
-- `app/api/call-sources`, `app/api/leaderboard-image` and `lib/publicSource.ts` (including
-- both the primary and the legacy fallback column lists). They use 13 columns between them.
--
-- 17 columns are readable today that no code path selects:
--
--   raw                  <- the raw Discord message text
--   message_id, channel_id, channel_name
--   confidence, parser_version, parser_confidence, parse_status, rejection_reason
--   raw_event_id, parsed_signal_id
--   called_liquidity_usd, latest_liquidity_usd
--   last_scanned_at, executed_at, edited_at, deleted_at
--
-- Column-level grants are the right tool here: RLS cannot restrict columns, and rewriting
-- the read path behind a view would change four call sites for no additional benefit.
--
-- ONE THING THIS DOES NOT HIDE: `caller`, the Discord display name, stays readable because
-- the caller leaderboard ranks on it. That is a product decision, not an oversight — if
-- caller identities should not be public, the leaderboard feature is what needs revisiting.
--
-- Impact today is small (`calls` holds 1 row) and grows with every ingested call, which is
-- why this is better settled before the worker starts writing.

begin;

-- BOTH roles. `authenticated` holds the same table-wide SELECT, and the policy is
-- USING (true) for role `public`, which covers logged-in users too — so revoking only anon
-- would leave every hidden column readable to anyone who signed up. Verified on the live
-- catalog 2026-07-31.
revoke select on table public.calls from anon, authenticated;

grant select (
  id,
  group_id,
  group_name,
  caller,              -- required by the caller leaderboard; see note above
  mint,
  symbol,
  called_mcap,
  peak_mcap,
  latest_mcap,
  called_price_usd,
  peak_price_usd,
  latest_price_usd,
  called_at
) on table public.calls to anon, authenticated;

commit;

-- VERIFY the app's columns still read and the sensitive ones do not:
--   select has_column_privilege('anon','public.calls','caller','SELECT') as caller_ok,   -- expect true
--          has_column_privilege('anon','public.calls','called_at','SELECT') as called_ok, -- expect true
--          has_column_privilege('anon','public.calls','raw','SELECT') as raw_blocked,     -- expect FALSE
--          has_column_privilege('anon','public.calls','channel_id','SELECT') as chan_blocked; -- expect FALSE
--
-- Then confirm the live endpoints still return rows:
--   curl -s "https://degenaration.vercel.app/api/calls?tf=7d" | head -c 200
--   curl -s "https://degenaration.vercel.app/api/call-sources" | head -c 200
--
-- ROLLBACK:
--   grant select on table public.calls to anon, authenticated;
