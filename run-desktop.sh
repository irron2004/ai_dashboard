#!/usr/bin/env bash
# One-click launcher for the AI Dashboard desktop app.
# Runs the Linux/Electron build inside WSL; the window shows via WSLg.
# Invoked by run-dashboard.bat (double-click on Windows) or directly: bash run-desktop.sh
set -uo pipefail

export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
cd /mnt/c/Users/irron/Desktop/my/ruahverce/ai_dashboard-main

# Stop any prior dev/preview/electron so each launch yields one fresh window.
# (pkill excludes its own PID, so this pattern is self-safe.)
pkill -f 'electron-vite|node_modules/electron/dist/electron' 2>/dev/null || true
sleep 1

echo "[run-desktop] building the latest code…"
if ! pnpm --filter @apc/desktop build; then
  echo "[run-desktop] BUILD FAILED — see output above." >&2
  read -r -p "Press Enter to close…" _ || true
  exit 1
fi

echo "[run-desktop] launching the app (close the window to quit)…"
exec pnpm --filter @apc/desktop start
