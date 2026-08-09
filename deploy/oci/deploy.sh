#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root so systemd units and the atomic release link can be updated." >&2
  exit 1
fi

DEPLOY_ROOT=/opt/degenaration
REPOSITORY_DIR="${DEPLOY_ROOT}/repository"
RELEASES_DIR="${DEPLOY_ROOT}/releases"
DEPLOY_BRANCH="${1:-codex/final-degenaration-2026-08-08}"

test -d "${REPOSITORY_DIR}/.git" || { echo "Missing ${REPOSITORY_DIR}; clone the GitHub repository there first." >&2; exit 1; }
test -s /etc/degenaration/worker.env || { echo "Missing /etc/degenaration/worker.env" >&2; exit 1; }
test -s /etc/degenaration/discord.env || { echo "Missing /etc/degenaration/discord.env" >&2; exit 1; }

git -C "${REPOSITORY_DIR}" fetch --prune origin "${DEPLOY_BRANCH}"
DEPLOY_SHA="$(git -C "${REPOSITORY_DIR}" rev-parse FETCH_HEAD)"
RELEASE_DIR="${RELEASES_DIR}/${DEPLOY_SHA}"

mkdir -p "${RELEASES_DIR}"
if [[ ! -d "${RELEASE_DIR}" ]]; then
  git -C "${REPOSITORY_DIR}" worktree add --detach "${RELEASE_DIR}" "${DEPLOY_SHA}"
fi

npm --prefix "${RELEASE_DIR}/server" ci --omit=dev
npm --prefix "${RELEASE_DIR}/server/bot" ci --omit=dev
chown -R degenaration:degenaration "${RELEASE_DIR}"
ln -sfn "${RELEASE_DIR}" "${DEPLOY_ROOT}/current.next"
mv -Tf "${DEPLOY_ROOT}/current.next" "${DEPLOY_ROOT}/current"
printf 'APP_BUILD_SHA=%s\nBOT_BUILD=%s\n' "${DEPLOY_SHA}" "${DEPLOY_SHA}" > /run/degenaration-release.env
chmod 0600 /run/degenaration-release.env

install -o root -g root -m 0644 "${RELEASE_DIR}/deploy/oci/degenaration-worker.service" /etc/systemd/system/degenaration-worker.service
install -o root -g root -m 0644 "${RELEASE_DIR}/deploy/oci/degenaration-discord.service" /etc/systemd/system/degenaration-discord.service
systemctl daemon-reload
systemctl enable degenaration-worker.service degenaration-discord.service
systemctl restart degenaration-worker.service degenaration-discord.service

echo "Deployed ${DEPLOY_SHA}. Run deploy/oci/verify.sh before changing production authority."
