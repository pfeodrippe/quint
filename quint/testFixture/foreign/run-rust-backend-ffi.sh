#!/usr/bin/env bash

set -euo pipefail

fixture_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$fixture_dir/../.." && pwd)"
repo_dir="$(cd "$project_dir/.." && pwd)"
evaluator_dir="$repo_dir/evaluator"
rust_dir="$fixture_dir/native-rust"

cargo build --manifest-path "$evaluator_dir/Cargo.toml" >/dev/null
cargo build --manifest-path "$rust_dir/Cargo.toml" >/dev/null

case "$(uname -s)" in
  Darwin)
    library="$rust_dir/target/debug/libquint_foreign_add1.dylib"
    ;;
  Linux)
    library="$rust_dir/target/debug/libquint_foreign_add1.so"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    library="$rust_dir/target/debug/quint_foreign_add1.dll"
    ;;
  *)
    echo "Unsupported OS for native ffi fixture: $(uname -s)" >&2
    exit 1
    ;;
esac

bindings_dir="$(mktemp -d "${TMPDIR:-/tmp}/quint-rust-native-bindings.XXXXXX")"
bindings="$bindings_dir/bindings.json"
trap 'rm -rf "$bindings_dir"' EXIT

cat >"$bindings" <<EOF
{
  "bindings": [
    {
      "kind": "ffi",
      "module": "foreignNative",
      "name": "add1",
      "library": "$library",
      "symbol": "add1_host"
    }
  ]
}
EOF

export QUINT_RUST_EVALUATOR_PATH="$evaluator_dir/target/debug/quint_evaluator"
node "$project_dir/dist/src/cli.js" "$@" --backend=rust --foreign-bindings "$bindings"
