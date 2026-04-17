#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$example_dir/../../.." && pwd)"
quint_dir="$repo_dir/quint"
native_dir="$example_dir/native-rust"
spec_path="$example_dir/bank-tap-debug.qnt"
bun_bin="${BUN_BIN:-}"

if [[ -z "$bun_bin" ]]; then
  bun_bin="$(command -v bun || true)"
fi

if [[ -z "$bun_bin" ]]; then
  echo "Bun is required for the raylib tap portal. Install bun or set BUN_BIN." >&2
  exit 1
fi

steps="${1:-80}"
seed="${2:-1}"

npm --prefix "$quint_dir" run compile >/dev/null
cargo build --manifest-path "$native_dir/Cargo.toml" >/dev/null

case "$(uname -s)" in
  Darwin)
    library="$native_dir/target/debug/libquint_raylib_demo.dylib"
    ;;
  Linux)
    library="$native_dir/target/debug/libquint_raylib_demo.so"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    library="$native_dir/target/debug/quint_raylib_demo.dll"
    ;;
  *)
    echo "Unsupported OS for raylib example: $(uname -s)" >&2
    exit 1
    ;;
esac

tap_file="$(mktemp "${TMPDIR:-/tmp}/quint-bank-taps.XXXXXX.jsonl")"
cleanup() {
  rm -f "$tap_file"
}
trap cleanup EXIT

"$bun_bin" "$example_dir/tap-portal.ts" "$tap_file" "$library" "Cosmos bank tap portal" &
viewer_pid=$!

sleep 1

node "$quint_dir/dist/src/cli.js" run "$spec_path" \
  --backend=typescript \
  --main=bankTapDebug \
  --init=init \
  --step=protocolStep \
  --invariant=totalSupplyInv \
  --max-samples=1 \
  --max-steps="$steps" \
  --seed="$seed" \
  --verbosity=0 \
  --tap-listener "jsonl:$tap_file"

wait "$viewer_pid"
