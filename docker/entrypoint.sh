#!/bin/sh
set -e

if [ -w /proc/sys/net/ipv6/ip_nonlocal_bind ]; then
  echo 1 > /proc/sys/net/ipv6/ip_nonlocal_bind
  echo "Enabled net.ipv6.ip_nonlocal_bind"
fi

exec node /app/dist/index.js
