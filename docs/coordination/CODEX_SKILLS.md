# Codex skills for the 2026-08-08 implementation

Use only the smallest relevant set for the active change.

| Capability | Skill |
|---|---|
| DegenAration money, trades, fees, withdrawals | `degenaration-financial-integrity` |
| Discord/KOL signal and performance pipeline | `degenaration-performance-journal` |
| Discord Gateway ingestion and acknowledgments | `degenaration-discord-runtime` |
| DegenAration frontend and responsive UI | `degenaration-ui` |
| Final evidence and release gates | `degenaration-release-audit` |
| Supabase migrations, RPCs, RLS, reconciliation | `supabase`, `supabase-postgres-best-practices` |
| Browser and responsive accessibility QA | `browser:control-in-app-browser` |
| Distinctive frontend direction | `frontend-design` |
| Security review and secret scanning | `codex-security:security-diff-scan` |
| Intentional commit, push, and draft PR workflow | `github:yeet` |

Node/TypeScript backend work uses the repository toolchain and tests. Solana/Jupiter
execution safety is governed by `degenaration-financial-integrity`, the launch spec, and
the explicit funded-mainnet approval gate; no extra third-party skill or package is needed.
