#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$PROJECT_DIR/web"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM

  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    if [[ -n "$pid" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
  done

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js。"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "错误：未找到 pnpm。"
  exit 1
fi

if [[ ! -f "$WEB_DIR/package.json" ]]; then
  echo "错误：找不到 $WEB_DIR/package.json。"
  exit 1
fi

if [[ ! -x "$WEB_DIR/node_modules/.bin/vite" || ! -d "$WEB_DIR/node_modules/better-sqlite3" ]]; then
  echo "首次运行或依赖不完整，正在安装 web 依赖……"
  (cd "$WEB_DIR" && pnpm install)
fi

echo "启动 ECutAuto-Clone 开发环境……"

(
  cd "$WEB_DIR"
  exec node server.mjs
) &
BACKEND_PID=$!

(
  cd "$WEB_DIR"
  exec pnpm dev --host 0.0.0.0
) &
FRONTEND_PID=$!

echo "前端：http://localhost:5174/"
echo "后端：http://localhost:8787/"
echo "按 Ctrl+C 同时停止两个服务。"

while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    wait "$BACKEND_PID" || exit $?
    echo "后端服务已停止。"
    exit 1
  fi

  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    wait "$FRONTEND_PID" || exit $?
    echo "前端服务已停止。"
    exit 1
  fi

  sleep 1
done
