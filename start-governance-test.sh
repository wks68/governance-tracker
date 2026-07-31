#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DB="/workspaces/dms-governance-relations-ui-preview.db"
SOURCE_DB="$ROOT/prisma/hotfix-ui-preview.db"
MIGRATION="$ROOT/prisma/migrations/20260730120000_add_typed_issue_relations/migration.sql"
PORT="3100"
SERVER_PID=""

cd "$ROOT"

if [[ ! -e "$DB" ]]; then
  if [[ ! -f "$SOURCE_DB" ]]; then
    echo "錯誤：找不到 Preview DB：$SOURCE_DB" >&2
    exit 1
  fi

  echo "建立持久化 Governance Test DB..."
  cp -- "$SOURCE_DB" "$DB"
fi

if [[ ! -f "$DB" ]]; then
  echo "錯誤：持久化 DB 不是一般檔案：$DB" >&2
  exit 1
fi

has_relation="$(sqlite3 "$DB" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='IssueRelation';")"

if [[ "$has_relation" != "1" ]]; then
  if [[ ! -f "$MIGRATION" ]]; then
    echo "錯誤：找不到 IssueRelation migration：$MIGRATION" >&2
    exit 1
  fi

  echo "套用 IssueRelation Migration..."
  sqlite3 "$DB" <<SQL
.bail on
BEGIN IMMEDIATE;
.read '$MIGRATION'
COMMIT;
SQL
fi

for table in User Issue IssueRelation; do
  exists="$(sqlite3 "$DB" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';")"

  if [[ "$exists" != "1" ]]; then
    echo "錯誤：持久化 DB 缺少資料表 $table，停止啟動。" >&2
    exit 1
  fi

  row_count="$(sqlite3 "$DB" "SELECT COUNT(*) FROM \"$table\";")"
  if [[ "$table" != "IssueRelation" && "$row_count" == "0" ]]; then
    echo "錯誤：持久化 DB 的 $table 沒有資料，停止啟動。" >&2
    exit 1
  fi

  echo "DB 驗證：$table = $row_count rows"
done

port_is_listening() {
  local listen_state
  listen_state="$(ss -H -ltn "sport = :$PORT" 2>/dev/null || true)"
  [[ -n "$listen_state" ]]
}

get_listener_pids() {
  local listener_state
  local listener_pids

  listener_state="$(ss -H -ltnp "sport = :$PORT" 2>/dev/null || true)"
  listener_pids="$(sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' <<<"$listener_state")"

  if [[ -z "$listener_pids" ]]; then
    listener_pids="$(
      lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
    )"
  fi

  sort -u <<<"$listener_pids" | sed '/^$/d'
}

stop_existing_listener() {
  local -a listener_pids=()
  local attempt

  if ! port_is_listening; then
    echo "Port $PORT 沒有舊 listener。"
    return
  fi

  mapfile -t listener_pids < <(get_listener_pids)
  if (( ${#listener_pids[@]} == 0 )); then
    echo "錯誤：Port $PORT 正在 LISTEN，但無法安全識別舊程序。" >&2
    exit 1
  fi

  echo "停止 Port $PORT 舊 listener：${listener_pids[*]}"
  kill -TERM "${listener_pids[@]}" 2>/dev/null || true

  for attempt in {1..20}; do
    port_is_listening || return 0
    sleep 0.25
  done

  mapfile -t listener_pids < <(get_listener_pids)
  if (( ${#listener_pids[@]} == 0 )); then
    echo "錯誤：Port $PORT 仍在 LISTEN，但無法安全識別舊程序。" >&2
    exit 1
  fi

  echo "舊 listener 未於期限內停止，送出 KILL：${listener_pids[*]}"
  kill -KILL "${listener_pids[@]}" 2>/dev/null || true

  for attempt in {1..20}; do
    port_is_listening || return 0
    sleep 0.25
  done

  echo "錯誤：無法釋放 Port $PORT。" >&2
  exit 1
}

cleanup_server() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

stop_existing_listener

declare -a server_env=(
  "DATABASE_URL=file:$DB"
  "NEXT_SERVER_ACTIONS_PREVIEW_PORT=$PORT"
)

codespace_name="${CODESPACE_NAME:-}"
forwarding_domain="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}"

if [[ -n "$codespace_name" || -n "$forwarding_domain" ]]; then
  if [[ -z "$codespace_name" || -z "$forwarding_domain" ]]; then
    echo "錯誤：Codespaces origin 需要 CODESPACE_NAME 與 GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN。" >&2
    exit 1
  fi

  allowed_origin="${codespace_name}-${PORT}.${forwarding_domain}"
  server_env+=("NEXT_SERVER_ACTIONS_ALLOWED_ORIGIN=$allowed_origin")
  echo "Codespaces allowed origin：$allowed_origin"
fi

echo "啟動 DMS Governance Tracker..."
trap cleanup_server EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

env "${server_env[@]}" \
  npm run dev -- --hostname 0.0.0.0 --port "$PORT" &
SERVER_PID="$!"

http_status="000"
for attempt in {1..60}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "錯誤：Next.js 在 smoke test 前退出。" >&2
    set +e
    wait "$SERVER_PID"
    server_status="$?"
    set -e
    SERVER_PID=""
    (( server_status == 0 )) && server_status=1
    exit "$server_status"
  fi

  http_status="$(curl --silent --show-error --output /dev/null \
    --write-out '%{http_code}' --max-time 5 \
    "http://127.0.0.1:${PORT}/login" 2>/dev/null || true)"

  [[ "$http_status" =~ ^[23][0-9]{2}$ ]] && break
  sleep 1
done

if [[ ! "$http_status" =~ ^[23][0-9]{2}$ ]]; then
  echo "錯誤：localhost smoke test 失敗，HTTP $http_status。" >&2
  exit 1
fi

if ! port_is_listening; then
  echo "錯誤：Port $PORT 未處於 LISTEN。" >&2
  exit 1
fi

echo "localhost smoke：HTTP $http_status"
echo "Port $PORT：LISTEN"

set +e
wait "$SERVER_PID"
server_status="$?"
set -e

SERVER_PID=""
trap - EXIT INT TERM
exit "$server_status"
