# DegenAration Release Record

Updated: 2026-07-26

## Baseline

- Web branch: `master`
- Web production: `https://degenaration.vercel.app`
- Discord service: `https://degencalls.onrender.com`
- Supabase project: `uqccguunmjabjheeivhx`
- Baseline revision: `17cdbea`

## Required Release Checks

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | Pending | `npm run typecheck` |
| Unit/integration tests | Pending | `npm run test` |
| Production build | Pending | `npm run build` |
| Desktop browser flows | Pending | Reference coverage matrix |
| Mobile browser flows | Pending | Reference coverage matrix |
| Supabase security advisor | Critical baseline issue | RLS disabled on `app_private.call_executions` |
| Supabase performance advisor | Pending | Run after DDL |
| Discord command smoke test | Pending | No outward test action allowed |
| Mainnet transaction test | Prohibited | Use paper/devnet only |

## Deployment Policy

- Push only verified, focused commits.
- Apply forward-safe migrations before deploying code that depends on them.
- Deploy Edge Function allowlists with matching database RPCs.
- Deploy the web after schema and bridge compatibility is verified.
- Deploy Discord gateway and automation worker independently.
- Keep `DELEGATED_SIGNING=off`, `COPY_TRADING=off`, and mainnet feature flags disabled
  until controlled review.

## Rollback

- Web: redeploy the previous verified Vercel revision.
- Edge Functions: redeploy the previous function version.
- Discord gateway/worker: deploy the previous Render commit.
- Database: use the rollback guidance embedded in each migration; never drop financial
  history during rollback.

