#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${GIT_BRANCH:-main}"
REMOTE="${GIT_REMOTE:-origin}"
LOCK_FILE="${ROOT_DIR}/.sync-us-insight.lock"
LOG_DIR="${ROOT_DIR}/logs"
LOG_FILE="${LOG_DIR}/vps-hourly-sync.log"
CHROME_PROFILE_DIR="${ROOT_DIR}/chrome_profile"
DISCORD_ENV_FILE="${DISCORD_ENV_FILE:-${HOME}/.config/stock-study/discord.env}"

if [[ -f "${DISCORD_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${DISCORD_ENV_FILE}"
  set +a
fi

cleanup_chrome() {
  if command -v pkill >/dev/null 2>&1; then
    pkill -f -- "--user-data-dir=${CHROME_PROFILE_DIR}" 2>/dev/null || true
  fi
}

notify_discord() {
  local message="$1"

  if [[ -z "${DISCORD_WEBHOOK_URL:-}" ]]; then
    echo "[$(date -Is)] discord notification skipped; DISCORD_WEBHOOK_URL is not set"
    return 0
  fi

  if ! node -e 'process.stdout.write(JSON.stringify({ content: process.argv[1].slice(0, 2000) }))' "${message}" \
    | curl -fsS \
      -H "Content-Type: application/json" \
      --data-binary @- \
      "${DISCORD_WEBHOOK_URL}" \
      >/dev/null; then
    echo "[$(date -Is)] discord notification failed"
  fi
}

handle_exit() {
  local status=$?
  cleanup_chrome

  if [[ "${status}" -ne 0 ]]; then
    notify_discord "[FAILED] Stock-Study sync exited with status ${status}. Check ${LOG_FILE}."
  fi
}

mkdir -p "${LOG_DIR}"
exec >> >(tee -a "${LOG_FILE}") 2>&1
cd "${ROOT_DIR}"
trap handle_exit EXIT

echo "[$(date -Is)] starting US Insight sync"
cleanup_chrome

notify_telegram() {
  local message="$1"

  if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
    echo "[$(date -Is)] telegram notification skipped; TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set"
    return 0
  fi

  if ! curl -fsS \
    -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${message}" \
    --data-urlencode "disable_web_page_preview=true" \
    >/dev/null; then
    echo "[$(date -Is)] telegram notification failed"
  fi
}

build_post_list_message() {
  local count="$1"
  local staged_docs="$2"

  node --input-type=module - "${count}" "${staged_docs}" <<'NODE'
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const count = Number(process.argv[2] || 0);
const stagedDocs = String(process.argv[3] || '')
  .split(/\r?\n/)
  .map((filePath) => basename(filePath.trim()))
  .filter(Boolean);

const posts = JSON.parse(readFileSync('public/data/posts.json', 'utf8'));
const postsByFileName = new Map(posts.map((post) => [post.fileName, post]));
const newPosts = stagedDocs
  .map((fileName) => postsByFileName.get(fileName))
  .filter(Boolean);

const displayCount = newPosts.length || count;
const lines = [`[담샘 여름학기] 새 글 ${displayCount}개가 올라왔습니다.`, ''];

if (newPosts.length === 0) {
  lines.push(`새 글 ${displayCount}개가 추가되었습니다.`);
} else {
  newPosts.forEach((post, index) => {
    lines.push(`${index + 1}. ${cleanTitle(post.title || post.fileName)}`);
  });
}

console.log(lines.join('\n'));

function cleanTitle(value) {
  return String(value || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
NODE
}

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date -Is)] another sync is already running; exiting"
  exit 0
fi

notify_discord "[STARTED] Stock-Study US Insight sync started at $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST')."

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
timeout --preserve-status 50m npm run sync:us-insight:new

if git diff --quiet -- public/data/posts.json public/docs; then
  echo "[$(date -Is)] no generated content changes"
  notify_discord "[NO CHANGES] Stock-Study sync completed; no new posts were found."
  exit 0
fi

npm run build

git add public/data/posts.json public/docs
if git diff --cached --quiet; then
  echo "[$(date -Is)] no staged content changes"
  exit 0
fi

STAGED_NEW_DOCS="$(git diff --cached --name-only --diff-filter=A -- 'public/docs/*.md')"
NEW_POST_COUNT="$(printf '%s\n' "${STAGED_NEW_DOCS}" | sed '/^$/d' | wc -l | tr -d ' ')"
COMMIT_TIME="$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST')"
git commit -m "chore: sync US Insight posts ${COMMIT_TIME}"
git push "${REMOTE}" "HEAD:${BRANCH}"

if [[ "${NEW_POST_COUNT}" -gt 0 ]]; then
  POST_LIST_MESSAGE="$(build_post_list_message "${NEW_POST_COUNT}" "${STAGED_NEW_DOCS}")"
  notify_discord "[SUCCESS] ${POST_LIST_MESSAGE}"
  notify_telegram "${POST_LIST_MESSAGE}"
else
  notify_discord "[SUCCESS] Stock-Study sync completed and changes were pushed to ${BRANCH}."
  echo "[$(date -Is)] telegram notification skipped; no new markdown posts"
fi

echo "[$(date -Is)] sync complete"
