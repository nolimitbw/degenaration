-- Run once in the Supabase SQL editor to remove the demo groups that the old schema
-- seeded into approved_groups (the servers you never actually approved).
-- After this, the Calls page shows ONLY servers you approve in the Admin panel.

delete from public.approved_groups
where name in ('Alpha Trenches', 'Solana Snipers', 'Pump Scouts', 'Degen Central');

-- Optional: if you want a completely clean slate (removes ALL groups + their calls),
-- uncomment the two lines below instead of the delete above.
-- delete from public.calls;
-- delete from public.approved_groups;
