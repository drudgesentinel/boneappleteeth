#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -u) != 0 ]]; then
  echo 'Run this helper as root: sudo bash /opt/hotdogcart/deploy/update.sh' >&2
  exit 1
fi

cd /opt/hotdogcart
if [[ -n $(git status --porcelain) ]]; then
  echo 'The checkout has local changes. Commit or resolve them before updating.' >&2
  exit 1
fi
if [[ $(node --version) != v24.* ]]; then
  echo 'Node.js 24 is required.' >&2
  exit 1
fi

git fetch --prune origin
git rev-parse --verify '@{upstream}' >/dev/null
if ! git merge-base --is-ancestor HEAD '@{upstream}'; then
  echo 'The checkout is ahead of or diverged from its upstream. Push or resolve it before updating.' >&2
  exit 1
fi

# Copy this helper to /tmp before invoking it so Git can safely replace its source.
# Stop before changing files to avoid serving a mixture of application versions.
on_failure() {
  systemctl stop hotdogcart.service || true
  echo 'Update failed. hotdogcart remains stopped; fix the checkout/build before starting it.' >&2
}
trap on_failure ERR
systemctl stop hotdogcart.service
git pull --ff-only
npm ci
npm test
npm run build
chown -R root:hotdogcart /opt/hotdogcart
chmod -R g+rX /opt/hotdogcart
systemd-analyze verify deploy/systemd/hotdogcart.service
install -m 0644 deploy/systemd/hotdogcart.service /etc/systemd/system/hotdogcart.service
systemctl daemon-reload
systemctl start hotdogcart.service
# A failed health check also stops the service so a broken update stays visible.
if ! curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3000/api/recipes >/dev/null; then
  systemctl stop hotdogcart.service
  on_failure
  exit 1
fi
trap - ERR
git log -1 --format='Deployed %h %s'
systemctl --no-pager status hotdogcart.service
