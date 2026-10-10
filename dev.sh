#!/usr/bin/env bash
# ---------------------------------------------------------------
#  kanban 本地开发环境一键启动（Git Bash / macOS / Linux）
#  用法： ./dev.sh       两个进程都在前台，Ctrl+C 一起停
#  浏览器访问 http://127.0.0.1:5173   账号 admin / admin
# ---------------------------------------------------------------
set -u
cd "$(dirname "$0")"

export GOTOOLCHAIN=local
API_PORT="${API_PORT:-8090}"
WEB_PORT="${WEB_PORT:-5173}"
mkdir -p .dev

# 依赖检查：缺什么说什么，不要等到子进程默默失败
missing=0
command -v go  >/dev/null 2>&1 || { echo "  [x] 找不到 go，请先安装 Go 1.24+ 并把它加进 PATH"; missing=1; }
command -v npm >/dev/null 2>&1 || { echo "  [x] 找不到 npm，请先安装 Node 22+ 并把它加进 PATH"; missing=1; }
if [ "$missing" = "1" ]; then exit 1; fi

if [ ! -d web/node_modules ]; then
  echo "  [!] 首次运行，正在安装前端依赖（约 1 分钟）…"
  (cd web && npm install --no-audit --no-fund) || exit 1
fi

# 端口探测：用 /dev/tcp，不依赖 curl，也不受代理环境变量影响
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if port_open "$API_PORT"; then
  echo "  [!] $API_PORT 已被占用，后端可能启动失败。"
  echo "      改端口：API_PORT=9090 ./dev.sh，前端再配 KANBAN_API=http://127.0.0.1:9090"
fi

cleanup() { kill 0 2>/dev/null; }
trap cleanup EXIT INT TERM

echo
echo "  kanban dev"
echo "  ---------------------------------------------"
echo "  API   http://127.0.0.1:$API_PORT   数据目录 .dev"
echo "  WEB   http://127.0.0.1:$WEB_PORT   <- 浏览器打开这个"
echo

# 后端：装了 air 就用 air（保存 .go 自动重启），否则 go run
if command -v air >/dev/null 2>&1; then
  echo "  [api] 使用 air 热重载"
  (cd server && exec air) 2>&1 | sed 's/^/[api] /' &
else
  echo "  [api] go run 编译中（首次约 20-30 秒，请稍等）…"
  (cd server && exec go run . -dev -addr "127.0.0.1:$API_PORT" -data ../.dev) 2>&1 | sed 's/^/[api] /' &
fi

# 前端：Vite HMR
(cd web && exec npm run dev) 2>&1 | sed 's/^/[web] /' &

# 等两个端口就绪，给一个明确的"可以了"信号
ready=0
for _ in $(seq 1 90); do
  port_open "$API_PORT" && port_open "$WEB_PORT" && { ready=1; break; }
  sleep 1
done

if [ "$ready" = "1" ]; then
  echo
  echo "  ✅ 就绪 → http://127.0.0.1:$WEB_PORT   (admin / admin)"
  echo "     停服务：Ctrl+C"
  echo
else
  echo
  echo "  [x] 90 秒内没起来，看上面的 [api] / [web] 报错"
  echo
  exit 1
fi

wait
