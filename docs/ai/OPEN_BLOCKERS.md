# Open blockers

Updated: 2026-08-01

Only external requirements belong here. Internally solvable work stays in
`IMPLEMENTATION_STATUS.md`.

| ID | Gate | Exact external requirement | State |
| --- | --- | --- | --- |
| E-1 | Marketplace deployment proof | Confirm a safe staging target, or explicitly authorize the already locally verified migration for the intended project. Production is unchanged. | BLOCKED |
| E-2 | Live Discord command and ingestion proof | Supply the configured Discord application credentials to the worker/test environment and a dedicated guild/channel where controlled fixtures may be posted. | BLOCKED |
| E-3 | Production worker | Provide a worker host, RPC/indexer configuration, Privy delegated-signing credentials, health alert destination, and deployment authorization. | BLOCKED |
| E-4 | Mainnet fee collection | Create/configure the correct Jupiter output-mint fee account or referral account; a wallet address alone is not a valid per-mint fee account. | BLOCKED |
| E-5 | Mainnet activation | Explicit controlled-mainnet authorization after staging, signer, reconciliation, provider, fee, withdrawal, alerting, and emergency-control gates pass. | BLOCKED |

