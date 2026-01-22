#!/usr/bin/env bash
set -euo pipefail

export PLAYWRIGHT_BROWSERS_PATH=0
export TZ="${TZ:-UTC}"

cd /usr/src/microsoft-rewards-script
exec node dist/index.js
