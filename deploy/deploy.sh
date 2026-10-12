#!/usr/bin/env bash
# Ship the project to the server, build there, restart the services.
#   deploy/deploy.sh user@host
# First time on the server, run deploy/server-setup.sh as root.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${1:?usage: deploy/deploy.sh user@host}
DIR=/opt/proof-of-ant

rsync -az --delete --chown=ant:ant \
  --exclude node_modules --exclude app/node_modules --exclude app/.next \
  --exclude .keys --exclude '.ledger*' --exclude test-ledger --exclude .anchor \
  --exclude 'app/.env*' --exclude 'target/deploy' --exclude 'target/debug' \
  --exclude 'target/release' --exclude 'target/sbf-*' --exclude art --exclude .DS_Store \
  ./ "$HOST:$DIR/"

# Build as the service user; root (or a sudoer) restarts the services.
ssh "$HOST" "set -euo pipefail
  sudo -u ant bash -c 'set -euo pipefail
    cd $DIR && npm install --no-audit --no-fund
    cd app && npm install --no-audit --no-fund
    set -a && . /etc/proof-of-ant.env && set +a && npx next build'
  sudo systemctl restart proof-of-ant-web proof-of-ant-crank
  sleep 5 && systemctl is-active proof-of-ant-web proof-of-ant-crank"
