#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/self-talk-feedback}"
PORT="${PORT:-3847}"
APP_USER="${APP_USER:-self-talk-feedback}"

echo "==> Installing Node.js 20 (if needed)"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p "process.versions.node.split('.')[0]")" -lt 20 ]]; then
  dnf module reset nodejs -y 2>/dev/null || true
  dnf module enable nodejs:20 -y
  dnf install -y nodejs git
fi
node -v
npm -v

echo "==> App user: $APP_USER"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin "$APP_USER"
fi

echo "==> App directory: $APP_DIR"
mkdir -p "$APP_DIR/data"
cd "$APP_DIR"

if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found in $APP_DIR"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "ERROR: .env missing. Copy .env.example to .env and set secrets."
  exit 1
fi

echo "==> npm install"
npm install --omit=dev

echo "==> Seed staff user"
npm run seed-staff

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> systemd service"
install -m 644 deploy/self-talk-feedback.service /etc/systemd/system/self-talk-feedback.service
systemctl daemon-reload
systemctl enable self-talk-feedback
systemctl restart self-talk-feedback
sleep 2
systemctl is-active self-talk-feedback

echo "==> Health check"
curl -sf "http://127.0.0.1:${PORT}/health" | head -c 500
echo

if systemctl is-active firewalld >/dev/null 2>&1; then
  echo "==> Opening port ${PORT}/tcp (restrict to NPM IP in production)"
  firewall-cmd --permanent --add-port="${PORT}/tcp" || true
  firewall-cmd --reload || true
fi

echo "Done. Set BIND_HOST=127.0.0.1 in .env when using a reverse proxy."
