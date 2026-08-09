# Runtime hosting decision

Decision date: 2026-08-09

## Decision

Use one Oracle Cloud Infrastructure Always Free Compute VM for the Discord Gateway listener
and execution worker. Run each Node process as a separate hardened `systemd` service, keep its
secrets in root-owned environment files, and expose only the two secret-free health endpoints.
Do not retire Railway or change the production authority until the OCI instance passes the
cutover checks below.

OCI is the only evaluated non-expiring free allocation that supports this repository's existing
long-running Node processes and outbound Discord WebSocket/HTTPS traffic without an application
rewrite or mandatory sleep. Oracle currently documents Always Free resources as available for
the life of the account. Its Ampere A1 allowance is 1,500 OCPU-hours and 9,000 GB-hours monthly,
equivalent for an Always Free tenancy to 2 OCPUs and 12 GB RAM. It also includes 200 GB of block
volume storage. The instance must be created in the tenancy's home region and capacity can be
temporarily unavailable. [Oracle Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm),
[Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Important limitation: Oracle may reclaim an Always Free VM when CPU, network, and—for A1—memory
all remain below 20% during a seven-day observation period. This is not a zero-operations SLA.
Monitor the VM and retain the documented redeploy procedure. Do not generate artificial load to
avoid reclamation. Oracle documents `systemd` restart policy and `journalctl` as the native Linux
service-management path used by this deployment. [Oracle systemd service management](https://docs.oracle.com/en-us/iaas/oracle-linux/systemd/systemd-service-management.htm)

## Rejected free options

| Provider | Current official constraint | Result |
| --- | --- | --- |
| Render Free | Free web services spin down after 15 minutes without inbound traffic; free background workers are unavailable and Render says free instances are not for production. | Reject: an outbound Discord Gateway session does not provide reliable inbound web traffic to prevent sleep. [Render Free](https://render.com/docs/free) |
| Koyeb Free | The free instance automatically scales to zero after one hour without inbound traffic and this cannot be disabled. | Reject: forced sleep breaks continuous Gateway ingestion. [Koyeb scale to zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero) |
| Cloudflare Workers / Durable Objects Free | Durable Objects can make outbound WebSockets, but an outbound connection prevents eviction for only 15 minutes; after that normal eviction rules resume. The runtime and CPU model also require a rewrite of the current Discord.js processes. | Reject for this migration: it does not preserve continuous residency of the existing client. [Cloudflare change note](https://developers.cloudflare.com/changelog/post/2026-06-19-outbound-connections-keep-dos-alive/), [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |

## Deployment shape

- OCI Ampere A1 Flex, 1 OCPU and 6 GB RAM initially, Ubuntu or Oracle Linux, in the tenancy home region.
- `/opt/degenaration/repository`: GitHub clone used only to fetch releases.
- `/opt/degenaration/releases/<commit>`: immutable release worktrees.
- `/opt/degenaration/current`: atomic symlink to the active release.
- `/etc/degenaration/worker.env` and `/etc/degenaration/discord.env`: mode `0600`, root-owned; never committed or printed.
- `degenaration-worker.service`: worker on loopback health port 10000.
- `degenaration-discord.service`: Discord listener on loopback health port 10001.
- Caddy terminates HTTPS on two DNS names and proxies to those loopback ports. The application
  deliberately refuses a plain-HTTP production worker-health URL because a spoofed readiness
  response could incorrectly unlock automation.

The repository contains the service units, redacted environment templates, atomic deployment
script, and verification script in `deploy/oci/`. GitHub is the release source; the server pulls
only the requested branch and deploys the exact resolved commit.

## Safe cutover

1. Create the OCI account/VM and network rules without altering Railway.
2. Clone the GitHub repository into `/opt/degenaration/repository`, create the `degenaration` system user, point two DNS names at the VM, and install Caddy using `deploy/oci/Caddyfile.example`.
3. Copy each environment value from the current host into the matching root-owned file without displaying it. Start in `WORKER_NET=devnet`, `DELEGATED_SIGNING=off`.
4. Run `sudo deploy/oci/deploy.sh <branch>` and `sudo deploy/oci/verify.sh`.
5. Confirm both HTTPS health documents report the intended commit/build, Discord login, command publication, and an approved-channel refresh. Set Vercel's `AUTOMATION_WORKER_URL` and `DEGENCALLS_HEALTH_URL` only after this passes.
6. Confirm production receives a fresh worker lease, then post one non-funded call in an approved test channel. Assert one journal version and exactly one acknowledgment.
7. Stop the candidate Discord service. Switch scanner authority away from Railway, start OCI Discord, and prove exactly one listener process and one acknowledgment. Never overlap two active listeners.
8. Keep trading signing off. Switch worker health configuration to OCI and confirm the web app remains `Pending` for the remaining mainnet gates.
9. Observe logs, health, journal writes, duplicate counts, and reconciliation for at least 30 minutes.
10. Only after all checks pass, disable Railway. Preserve its configuration until the OCI deployment has remained healthy through the observation window.

## Current blocker

The repository has no OCI CLI configuration or authenticated OCI account on this workstation.
Provisioning the VM is therefore the one external account action needed before deployment and
production verification. No Railway service has been stopped, no production authority has been
changed, and no mainnet signing has been enabled.
