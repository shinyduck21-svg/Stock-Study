#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${GIT_BRANCH:-main}"
REMOTE="${GIT_REMOTE:-origin}"
LOCK_FILE="${ROOT_DIR}/.sync-us-insight.lock"
LOG_DIR="${ROOT_DIR}/logs"
LOG_FILE="${LOG_DIR}/vps-hourly-sync.log"

mkdir -p "${LOG_DIR}"
exec >> >(tee -a "${LOG_FILE}") 2>&1
cd "${ROOT_DIR}"

echo "[$(date -Is)] starting US Insight sync"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date -Is)] another sync is already running; exiting"
  exit 0
fi

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    echo "[$(date -Is)] package-lock.json not found; falling back to npm install"
    npm install
  fi
fi

git fetch "${REMOTE}" "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only "${REMOTE}" "${BRANCH}"

export CHROME_HEADLESS="${CHROME_HEADLESS:-1}"
npm run sync:us-insight:new

if git diff --quiet -- public/data/posts.json public/docs; then
  echo "[$(date -Is)] no generated content changes"
  exit 0
fi

npm run build

git add public/data/posts.json public/docs
if git diff --cached --quiet; then
  echo "[$(date -Is)] no staged content changes"
  exit 0
fi

COMMIT_TIME="$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST')"
git commit -m "chore: sync US Insight posts ${COMMIT_TIME}"
git push "${REMOTE}" "HEAD:${BRANCH}"

echo "[$(date -Is)] sync complete"
