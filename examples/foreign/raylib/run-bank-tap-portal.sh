#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$example_dir/../../.." && pwd)"
quint_dir="$repo_dir/quint"
native_dir="$example_dir/native-rust"
spec_path="$example_dir/bank-tap-debug.qnt"
bindings_path="$example_dir/tap-portal-bindings.json"
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

"$bun_bin" "$quint_dir/dist/src/cli.js" run "$spec_path" \
  --backend=typescript \
  --main=bankTapDebug \
  --init=init \
  --step=protocolStep \
  --invariant=totalSupplyInv \
  --max-samples=1 \
  --max-steps="$steps" \
  --seed="$seed" \
  --verbosity=0 \
  --foreign-bindings "$bindings_path" \
  --tap-listener-op bankTapDebug.tapPortalListener
