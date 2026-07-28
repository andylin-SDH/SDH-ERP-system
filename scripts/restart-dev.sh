#!/usr/bin/env bash
# 清掉卡死的 Next dev（預設 3000）並重新啟動
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ 嘗試結束佔用 3000 / 3002 的 process…"
if command -v lsof >/dev/null 2>&1; then
  for PORT in 3000 3002; do
    PIDS=$(lsof -ti :${PORT} 2>/dev/null || true)
    if [[ -n "${PIDS}" ]]; then
      kill -9 ${PIDS} 2>/dev/null || true
    fi
  done
  sleep 1
fi

rm -rf .next
rm -f .next/dev/lock 2>/dev/null || true
echo "→ 啟動 dev（webpack，http://localhost:3002）…"
exec npx next dev -H 0.0.0.0 -p 3002 --webpack
