#!/usr/bin/env bash
# One-time server setup (Ubuntu/Debian, as root): Node, nginx, the app user and the services.
#   scp deploy/* root@host:/tmp/poa/ && ssh root@host bash /tmp/poa/server-setup.sh
set -euo pipefail
HERE=$(dirname "$0")

apt-get update
apt-get install -y curl rsync bc nginx certbot python3-certbot-nginx
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# next build wants more than 2 GB on a small VPS.
if [ "$(swapon --show=SIZE --bytes --noheadings | paste -sd+ | bc 2>/dev/null || echo 0)" -lt 2000000000 ] && [ ! -f /swap-poa ]; then
  fallocate -l 2G /swap-poa && chmod 600 /swap-poa && mkswap /swap-poa && swapon /swap-poa
  echo "/swap-poa none swap sw 0 0" >> /etc/fstab
fi

id ant >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash ant
mkdir -p /opt/proof-of-ant/.keys
chown -R ant:ant /opt/proof-of-ant
chmod 700 /opt/proof-of-ant/.keys
# The deploy user restarts the services without a password.
echo "ant ALL=(root) NOPASSWD: /usr/bin/systemctl restart proof-of-ant-web proof-of-ant-crank" > /etc/sudoers.d/proof-of-ant

[ -f /etc/proof-of-ant.env ] || install -m 640 -o root -g ant "$HERE/env.example" /etc/proof-of-ant.env
install -m 644 "$HERE/proof-of-ant-web.service" "$HERE/proof-of-ant-crank.service" /etc/systemd/system/
install -m 644 "$HERE/nginx.conf" /etc/nginx/sites-available/proof-of-ant
ln -sf /etc/nginx/sites-available/proof-of-ant /etc/nginx/sites-enabled/proof-of-ant
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
systemctl daemon-reload
systemctl enable proof-of-ant-web proof-of-ant-crank
echo "done: fill /etc/proof-of-ant.env, put the crank key in /opt/proof-of-ant/.keys/crank.json, then deploy"
