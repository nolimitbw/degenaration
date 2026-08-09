# Codex review

Findings from the independent reviewer. Each entry needs severity, file/line evidence,
reproduction, and expected behavior. Claude resolves each with a commit and evidence, or
rejects it with evidence, or marks it blocked.

## Status

**Final implementation audit completed 2026-08-09** on
`codex/final-degenaration-2026-08-08`. The complete release suite passed, the deployed app
SHA matched the audited commit, Supabase advisors were reviewed, and production correctly
remained Pending. External OCI and funded-mainnet gates are recorded in
`docs/coordination/OPEN_BLOCKERS.md`.

## Findings

| ID | Severity | File:line | Finding | Status |
|---|---|---|---|---|
| C-1 | Moderate | `package-lock.json` | Production audit initially contained a high transitive nanoid advisory and fixable Hono advisories | RESOLVED — safe lockfile refresh removed all high findings; 12 moderate transitive wallet/Solana advisories remain because npm's proposed fixes are breaking downgrades |
| C-2 | Warning | Supabase Auth project setting | Leaked-password protection is disabled | EXTERNAL — enable in Auth dashboard if password auth is retained |
| C-3 | Info | `app_private.*` | Advisor reports RLS enabled with no policy | ACCEPTED — these private tables intentionally expose no direct client policy; access is through revoked, secret-checked RPC boundaries |
