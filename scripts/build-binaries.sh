#!/usr/bin/env bash
# Build standalone Consilium CLI binaries for distribution.
#
# Requires Bun (https://bun.sh). Output: dist-binaries/consilium-<os>-<arch>
# Targets: linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64
#
# Usage:
#   ./packages/cli/scripts/build-binaries.sh
#   ./packages/cli/scripts/build-binaries.sh --target darwin-arm64

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "[build-binaries] Bun not found. Install: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

ENTRY="src/index.ts"
OUT_DIR="dist-binaries"
mkdir -p "${OUT_DIR}"

ALL_TARGETS=(
  "bun-linux-x64:linux-x64"
  "bun-linux-arm64:linux-arm64"
  "bun-darwin-x64:darwin-x64"
  "bun-darwin-arm64:darwin-arm64"
  "bun-windows-x64:windows-x64"
)

want_target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) want_target="$2"; shift 2 ;;
    --target=*) want_target="${1#--target=}"; shift ;;
    -h|--help)
      cat <<EOF
Build Consilium CLI standalone binaries.

Options:
  --target <name>   Build only one target (e.g. darwin-arm64)
  -h, --help        Show this help

Default: build all targets.
EOF
      exit 0 ;;
    *)
      echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

build_one() {
  local bun_target="$1"
  local out_suffix="$2"
  local out_path="${OUT_DIR}/consilium-${out_suffix}"
  if [ "${out_suffix}" = "windows-x64" ]; then
    out_path="${out_path}.exe"
  fi
  echo "[build-binaries] ${out_suffix} -> ${out_path}"
  bun build "${ENTRY}" \
    --compile \
    --target "${bun_target}" \
    --minify \
    --outfile "${out_path}"
}

if [ -n "${want_target}" ]; then
  found=false
  for entry in "${ALL_TARGETS[@]}"; do
    bun_target="${entry%%:*}"
    suffix="${entry##*:}"
    if [ "${suffix}" = "${want_target}" ]; then
      build_one "${bun_target}" "${suffix}"
      found=true
      break
    fi
  done
  if ! ${found}; then
    echo "Unknown target: ${want_target}" >&2
    echo "Available: linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64" >&2
    exit 2
  fi
else
  for entry in "${ALL_TARGETS[@]}"; do
    bun_target="${entry%%:*}"
    suffix="${entry##*:}"
    build_one "${bun_target}" "${suffix}"
  done
fi

echo "[build-binaries] Done."
ls -lh "${OUT_DIR}/"
