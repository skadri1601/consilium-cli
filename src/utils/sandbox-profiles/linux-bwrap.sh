#!/usr/bin/env bash
set -euo pipefail

CWD="${CONSILIUM_SANDBOX_CWD:-$PWD}"
ALLOW_NETWORK="${CONSILIUM_SANDBOX_ALLOW_NETWORK:-0}"

if [ "$#" -lt 1 ]; then
  echo "linux-bwrap.sh: missing command" >&2
  exit 64
fi

NET_FLAG=()
if [ "$ALLOW_NETWORK" = "1" ]; then
  NET_FLAG=(--share-net)
fi

exec bwrap \
  --ro-bind / / \
  --bind "$CWD" "$CWD" \
  --tmpfs /tmp \
  --dev /dev \
  --proc /proc \
  --unshare-all \
  "${NET_FLAG[@]}" \
  "$@"
