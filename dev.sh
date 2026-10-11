#!/usr/bin/env bash
# 松鼠看板本地开发：Vite 热更新 + Go 后端，Ctrl+C 停止本次启动的进程。
set -euo pipefail
cd "$(dirname "$0")"
export GOTOOLCHAIN=local
API_PORT="${API_PORT:-8090}"
WEB_PORT="${WEB_PORT:-5173}"
command -v go >/dev/null || { echo '请先安装 Go 1.24+'; exit 1; }
command -v npm >/dev/null || { echo '请先安装 Node 22+'; exit 1; }
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for port in "$API_PORT" "$WEB_PORT"; do
  if port_open "$port"; then echo "端口 $port 已占用，请通过 API_PORT / WEB_PORT 换端口。"; exit 1; fi
done
DEV_DATA_DIR="${DEV_DATA_DIR:-$PWD/.dev}"
mkdir -p "$DEV_DATA_DIR" .dev server/static
[ -e server/static/.gitkeep ] || : > server/static/.gitkeep
if [ ! -d web/node_modules ]; then (cd web && npm ci --no-audit --no-fund); fi
export KANBAN_API="http://127.0.0.1:$API_PORT"
export KANBAN_ADDR="127.0.0.1:$API_PORT"
export KANBAN_DATA="$DEV_DATA_DIR"
export KANBAN_DEV=1
api_pid=''
web_pid=''
cleanup() {
  trap - EXIT INT TERM
  [ -z "$api_pid" ] || kill "$api_pid" 2>/dev/null || true
  [ -z "$web_pid" ] || kill "$web_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if command -v air >/dev/null 2>&1; then
  (cd server && exec air) &
else
  echo '正在编译 Go 后端…'
  (cd server && go build -o ../.dev/squirrel-dev .)
  (cd server && exec ../.dev/squirrel-dev) &
fi
api_pid=$!
# 直接启动 Vite，进程归当前脚本管理，避免 npm 子进程遗留。
(cd web && exec node node_modules/vite/bin/vite.js --port "$WEB_PORT" --strictPort) &
web_pid=$!
ready=0
for ((i=0; i<90; i++)); do
  kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null || { echo '服务启动失败，请查看上方错误。'; exit 1; }
  if port_open "$API_PORT" && port_open "$WEB_PORT"; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo '服务启动超时，请查看上方错误。'; exit 1; }
echo "松鼠看板已就绪 → http://127.0.0.1:${WEB_PORT}（Ctrl+C 停止）"
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do sleep 1; done
echo '一个服务已经退出，正在停止另一个服务。'
exit 1
