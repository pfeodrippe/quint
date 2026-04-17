#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$example_dir/../../.." && pwd)"
quint_dir="$repo_dir/quint"
native_dir="$example_dir/native-rust"
spec_path="$example_dir/bank-live-debug.qnt"
bun_bin="${BUN_BIN:-}"

if [[ -z "$bun_bin" ]]; then
  bun_bin="$(command -v bun || true)"
fi

if [[ -z "$bun_bin" ]]; then
  echo "Bun is required for the trace debugger viewer. Install bun or set BUN_BIN." >&2
  exit 1
fi

trace_count="${1:-12}"
max_samples="${2:-64}"
max_steps="${3:-20}"
seed="${4:-1}"

if (( max_samples < trace_count )); then
  echo "max_samples must be >= trace_count" >&2
  exit 1
fi

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

trace_dir="$(mktemp -d "${TMPDIR:-/tmp}/quint-bank-traces.XXXXXX")"
cleanup() {
  rm -rf "$trace_dir"
}
trap cleanup EXIT

"$bun_bin" "$quint_dir/dist/src/cli.js" run "$spec_path" \
  --backend=typescript \
  --main=bankLiveDebug \
  --init=init \
  --step=protocolStep \
  --invariant=totalSupplyInv \
  --max-samples="$max_samples" \
  --n-traces="$trace_count" \
  --max-steps="$max_steps" \
  --seed="$seed" \
  --verbosity=0 \
  --out-itf "$trace_dir/trace_{seq}.itf.json"

"$bun_bin" "$example_dir/trace-debugger.ts" bank "$trace_dir" "$library"
