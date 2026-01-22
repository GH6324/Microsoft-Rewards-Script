#!/bin/sh
set -e

# Ensure Playwright uses preinstalled browsers
export PLAYWRIGHT_BROWSERS_PATH=0

# 1. Timezone: default to UTC if not provided
: "${TZ:=UTC}"
ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime
echo "$TZ" > /etc/timezone
dpkg-reconfigure -f noninteractive tzdata

# 2. Validate CRON_SCHEDULE
if [ -z "${CRON_SCHEDULE:-}" ]; then
  echo "ERROR: CRON_SCHEDULE environment variable is not set." >&2
  echo "Please set CRON_SCHEDULE (e.g., \"0 2 * * *\")." >&2
  exit 1
fi

# 3. Initial run without sleep if RUN_ON_START=true
if [ "${RUN_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Starting initial run in background at $(date)"
  (
    cd /usr/src/microsoft-rewards-script || {
      echo "[entrypoint-bg] ERROR: Unable to cd to /usr/src/microsoft-rewards-script" >&2
      exit 1
    }
    # Skip random sleep for initial run, but preserve setting for cron jobs
    SKIP_RANDOM_SLEEP=true scripts/docker/run_daily.sh
    echo "[entrypoint-bg] Initial run completed at $(date)"
  ) &
  echo "[entrypoint] Background process started (PID: $!)"
fi

# 设置 cron 任务
if [ -f "/etc/cron.d/microsoft-rewards-cron.template" ]; then
    # 替换模板中的占位符
    sed -i "s|SCRIPT_PATH|/usr/src/microsoft-rewards-script/src/run_daily.sh|g" /etc/cron.d/microsoft-rewards-cron.template
    
    # 启用 cron 任务
    cp /etc/cron.d/microsoft-rewards-cron.template /etc/cron.d/microsoft-rewards-cron
    chmod 0644 /etc/cron.d/microsoft-rewards-cron
    
    # 启动 cron 服务
    echo "Starting cron service..."
    service cron start
    
    # 检查 cron 服务状态
    if service cron status; then
        echo "Cron service started successfully"
    else
        echo "Warning: Cron service failed to start"
    fi
else
    echo "Warning: Cron template not found at /etc/cron.d/microsoft-rewards-cron.template"
fi

# 启动应用
echo "Starting Microsoft Rewards Script..."
exec "$@"
