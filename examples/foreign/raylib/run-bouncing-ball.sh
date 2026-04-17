#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$example_dir/../../.." && pwd)"
quint_dir="$repo_dir/quint"
evaluator_dir="$repo_dir/evaluator"
native_dir="$example_dir/native-rust"
spec_path="$example_dir/bouncing-ball.qnt"

npm --prefix "$quint_dir" run compile >/dev/null
cargo build --manifest-path "$evaluator_dir/Cargo.toml" >/dev/null
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

bindings_dir="$(mktemp -d "${TMPDIR:-/tmp}/quint-raylib-bindings.XXXXXX")"
bindings="$bindings_dir/bindings.json"
cleanup() {
  rm -rf "$bindings_dir"
}
trap cleanup EXIT

cat >"$bindings" <<EOF
{
  "bindings": [
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "showHelloWindow",
      "library": "$library",
      "symbol": "show_hello_window_host"
    },
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "rlClearScene",
      "library": "$library",
      "symbol": "rl_clear_scene_host"
    },
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "rlSetCounter",
      "library": "$library",
      "symbol": "rl_set_counter_host"
    },
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "rlDrawText",
      "library": "$library",
      "symbol": "rl_draw_text_host"
    },
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "rlDrawTextInt",
      "library": "$library",
      "symbol": "rl_draw_text_int_host"
    },
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "rlDrawCircle",
      "library": "$library",
      "symbol": "rl_draw_circle_host"
    },
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "rlDrawRect",
      "library": "$library",
      "symbol": "rl_draw_rect_host"
    },
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "rlSleepMillis",
      "library": "$library",
      "symbol": "rl_sleep_millis_host"
    },
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "rlWindowShouldClose",
      "library": "$library",
      "symbol": "rl_window_should_close_host"
    },
    {
      "kind": "ffi",
      "module": "raylibDemo",
      "name": "rlCloseWindow",
      "library": "$library",
      "symbol": "rl_close_window_host"
    }
  ]
}
EOF

export QUINT_RUST_EVALUATOR_PATH="$evaluator_dir/target/debug/quint_evaluator"

start_repl() {
  node "$quint_dir/dist/src/cli.js" repl \
    --backend=rust \
    -r "$spec_path::bouncingBallLive" \
    --foreign-bindings "$bindings" \
    "$@"
}

mode="${1:-play}"
if [[ "$mode" == "repl" ]]; then
  start_repl
  exit $?
fi

steps=180
delay=0.04
if [[ "$mode" != "play" ]]; then
  steps="$mode"
fi

commands=("init" "drawCurrentState")
for _ in $(seq 1 "$steps"); do
  commands+=("step" "drawCurrentState")
done
commands+=("rlCloseWindow" ".exit")

start_repl "${commands[@]}" >/dev/null
