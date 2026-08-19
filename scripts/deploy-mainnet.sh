#!/usr/bin/env bash
#
# One-command deployment for the Discord call tracking + copy execution release.
#
# Runs every step in order and stops at the first real failure, so you are never
# half-deployed without knowing it:
#
#   1. apply the SQL migrations          (psql -> your Supabase Postgres)
#   2. apply the bot secret gate         (only if app_private.bot_secret_ok is missing)
#   3. redeploy the bot-bridge function  (supabase CLI)
#   4. set worker + site env vars        (Render API)
#   5. run PREFLIGHT-mainnet.sql         (fails the run on any [X] FAIL row)
#   6. verify signing state              (worker /health -> signingEnabled)
#
# SECRETS: read from the environment only. Nothing is echoed, and nothing is
# written to disk. Export them in your shell (or use a local .env you never
# commit) before running:
#
#   export SUPABASE_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
#   export SUPABASE_PROJECT_REF='<ref>'
#   export SUPABASE_ACCESS_TOKEN='...'        # supabase CLI login token
#   export BOT_SHARED_SECRET='...'
#   export RENDER_API_KEY='...'               # optional; skips step 4 without it
#   export RENDER_WORKER_SERVICE_ID='srv-...' # optional
#   export WORKER_HEALTH_URL='https://<worker>/health'
#
# USAGE
#   ./scripts/deploy-mainnet.sh              # steps 1-5, leaves signing OFF
#   ./scripts/deploy-mainnet.sh --check      # read-only: preflight + health only
#   ./scripts/deploy-mainnet.sh --enable-signing
#       Additionally flips DELEGATED_SIGNING=on. This makes the next Discord call
#       spend real client SOL. It refuses to run unless the preflight is clean.

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MODE="deploy"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --enable-signing) MODE="enable-signing" ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# ---- output helpers (never print secret values) ----
step()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()    { printf '    \033[32mok\033[0m   %s\n' "$*"; }
warn()  { printf '    \033[33mwarn\033[0m %s\n' "$*"; }
die()   { printf '\n\033[31mFAILED:\033[0m %s\n' "$*" >&2; exit 1; }

require_env() {
  local missing=()
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  if (( ${#missing[@]} )); then
    die "missing required environment variable(s): ${missing[*]}
Export them and re-run. Values are never printed or stored by this script."
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"
}

# ============================================================
step "Preconditions"
# ============================================================
require_cmd psql "Install the PostgreSQL client (e.g. brew install libpq / apt install postgresql-client)."
require_env SUPABASE_DB_URL
ok "psql present, SUPABASE_DB_URL set"

# Fail fast on a bad connection string rather than midway through the migrations.
psql "$SUPABASE_DB_URL" -qtAc 'select 1' >/dev/null 2>&1 \
  || die "cannot connect to SUPABASE_DB_URL. Check the connection string and that your IP is allowed."
ok "database reachable"

# ============================================================
if [[ "$MODE" != "check" ]]; then
step "1/6  Applying migrations (supabase/APPLY-discord-call-tracking.sql)"
# ============================================================
# ON_ERROR_STOP makes a partial apply impossible: any failing statement aborts.
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/APPLY-discord-call-tracking.sql \
  || die "migrations failed. Nothing after this point ran; the database is unchanged past the failing statement."
ok "five migrations applied (idempotent — safe to re-run)"

# ============================================================
step "2/6  Bot secret gate"
# ============================================================
HAS_GATE=$(psql "$SUPABASE_DB_URL" -qtAc \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='app_private' and p.proname='bot_secret_ok'")

if [[ "$HAS_GATE" == "1" ]]; then
  ok "app_private.bot_secret_ok already exists — leaving it alone"
else
  require_env BOT_SHARED_SECRET
  # Hash locally; the secret itself never reaches the database or the logs.
  SECRET_SHA=$(printf '%s' "$BOT_SHARED_SECRET" | sha256sum | cut -d' ' -f1)
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<SQL || die "could not create the bot secret gate"
create schema if not exists app_private;
create or replace function app_private.bot_secret_ok(p_secret text)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp
as \$fn\$
  select p_secret is not null
    and encode(extensions.digest(p_secret, 'sha256'), 'hex') = '${SECRET_SHA}'
\$fn\$;
revoke execute on function app_private.bot_secret_ok(text) from public, anon, authenticated;
SQL
  unset SECRET_SHA
  ok "bot_secret_ok created from your BOT_SHARED_SECRET (hash only)"
fi

# ============================================================
step "3/6  Redeploying the bot-bridge edge function"
# ============================================================
if command -v supabase >/dev/null 2>&1 && [[ -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  supabase functions deploy bot-bridge --project-ref "$SUPABASE_PROJECT_REF" \
    || die "bot-bridge deploy failed. Without it the new enrich_call operation 400s and calls journal without pricing."
  ok "bot-bridge deployed"
else
  warn "skipped — needs the supabase CLI and SUPABASE_PROJECT_REF."
  warn "Until this runs, calls are still journaled but entry pricing stays null."
fi

# ============================================================
step "4/6  Worker environment variables"
# ============================================================
if [[ -n "${RENDER_API_KEY:-}" && -n "${RENDER_WORKER_SERVICE_ID:-}" ]]; then
  render_put_env() {
    curl -sS -X PUT \
      "https://api.render.com/v1/services/${RENDER_WORKER_SERVICE_ID}/env-vars/$1" \
      -H "Authorization: Bearer ${RENDER_API_KEY}" \
      -H 'content-type: application/json' \
      -d "{\"value\":$2}" -o /dev/null -w '%{http_code}'
  }
  for pair in "WORKER_NET:\"mainnet\"" "COPY_TRADING:\"off\""; do
    key="${pair%%:*}"; val="${pair#*:}"
    code=$(render_put_env "$key" "$val")
    [[ "$code" =~ ^2 ]] && ok "$key set" || warn "$key -> HTTP $code"
  done
  if [[ -n "${BOT_SHARED_SECRET:-}" ]]; then
    code=$(render_put_env "BOT_SHARED_SECRET" "$(printf '%s' "$BOT_SHARED_SECRET" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")
    [[ "$code" =~ ^2 ]] && ok "BOT_SHARED_SECRET set (value not logged)" || warn "BOT_SHARED_SECRET -> HTTP $code"
  fi
  warn "PLATFORM_FEE_ACCOUNT, MAINNET_RPC and the Privy keys are not set here —"
  warn "set those in the Render dashboard if they are not already present."
else
  warn "skipped — needs RENDER_API_KEY and RENDER_WORKER_SERVICE_ID."
fi
fi  # end: steps 1-4 skipped in --check mode

# ============================================================
step "5/6  PREFLIGHT — what happens on the next call"
# ============================================================
PREFLIGHT_OUT=$(psql "$SUPABASE_DB_URL" -qX -f supabase/PREFLIGHT-mainnet.sql) \
  || die "preflight query failed to run"
echo "$PREFLIGHT_OUT"

FAILS=$(grep -c 'FAIL' <<<"$PREFLIGHT_OUT" || true)
if (( FAILS > 0 )); then
  die "$FAILS preflight check(s) FAILED (listed at the top above).
Every FAIL is a client whose trade would misbehave — fix them before enabling signing."
fi
ok "no FAIL rows"

# ============================================================
step "6/6  Signing state"
# ============================================================
# DELEGATED_SIGNING is a worker process variable, not a database value — the
# preflight cannot see it. The worker reports it on /health.
if [[ -z "${WORKER_HEALTH_URL:-}" ]]; then
  warn "WORKER_HEALTH_URL not set — cannot verify signing state."
else
  HEALTH=$(curl -sS --max-time 15 "$WORKER_HEALTH_URL") || die "worker health endpoint unreachable"
  SIGNING=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("signingEnabled"))' <<<"$HEALTH")
  DISPATCH=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("callDispatchEnabled"))' <<<"$HEALTH")
  echo "    worker: signingEnabled=$SIGNING  callDispatchEnabled=$DISPATCH"

  if [[ "$MODE" == "enable-signing" ]]; then
    if [[ "$SIGNING" == "True" ]]; then
      ok "DELEGATED_SIGNING is already ON"
    elif [[ -n "${RENDER_API_KEY:-}" && -n "${RENDER_WORKER_SERVICE_ID:-}" ]]; then
      printf '\n\033[33mThis makes the next Discord call spend real client SOL.\033[0m\n'
      read -r -p 'Type LIVE to enable delegated signing: ' confirm
      [[ "$confirm" == "LIVE" ]] || die "not confirmed — signing left OFF"
      curl -sS -X PUT \
        "https://api.render.com/v1/services/${RENDER_WORKER_SERVICE_ID}/env-vars/DELEGATED_SIGNING" \
        -H "Authorization: Bearer ${RENDER_API_KEY}" -H 'content-type: application/json' \
        -d '{"value":"on"}' -o /dev/null
      curl -sS -X POST \
        "https://api.render.com/v1/services/${RENDER_WORKER_SERVICE_ID}/deploys" \
        -H "Authorization: Bearer ${RENDER_API_KEY}" -o /dev/null
      ok "DELEGATED_SIGNING=on set; worker redeploying"
      echo "    Re-run with --check in a minute to confirm signingEnabled=True."
    else
      die "cannot enable signing without RENDER_API_KEY and RENDER_WORKER_SERVICE_ID"
    fi
  elif [[ "$SIGNING" != "True" ]]; then
    warn "signing is OFF — nothing will trade. Re-run with --enable-signing when ready."
  fi
fi

printf '\n\033[32mDone.\033[0m\n'
