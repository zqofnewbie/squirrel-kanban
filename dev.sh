#!/usr/bin/env bash
# macOS / Linux entry point; Windows uses the same Node supervisor.
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Please install Node.js 22+ and add it to PATH.'; exit 1; }
exec node scripts/dev.mjs
