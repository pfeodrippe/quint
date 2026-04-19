#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$example_dir/../../.." && pwd)"
quint_dir="$repo_dir/quint"
native_dir="$example_dir/native-rust"
bun_bin="${BUN_BIN:-}"

if [[ -z "$bun_bin" ]]; then
  bun_bin="$(command -v bun || true)"
fi

if [[ -z "$bun_bin" ]]; then
  echo "Bun is required for the raylib live statistics dashboard. Install bun or set BUN_BIN." >&2
  exit 1
fi

target="${1:-random-walk}"
samples="${2:-200}"
seed="${3:-1}"
custom_max_steps="${4:-}"

case "$target" in
  random-walk)
    spec_path="$example_dir/statistics-live-random-walk.qnt"
    main="randomWalkStats"
    invariant="boundsInv"
    max_steps=81
    ;;
  die-hard)
    spec_path="$example_dir/statistics-live-die-hard.qnt"
    main="dieHardStats"
    invariant="boundsInv"
    max_steps=401
    ;;
  two-phase-commit)
    spec_path="$example_dir/statistics-live-two-phase-commit.qnt"
    main="twoPhaseCommitStats"
    invariant="consistencyInv"
    max_steps=21
    ;;
  lamport-mutex)
    spec_path="$example_dir/statistics-live-lamport-mutex.qnt"
    main="lamportMutexStats"
    invariant="mutexInv"
    max_steps=81
    ;;
  dining-philosophers)
    spec_path="$example_dir/statistics-live-dining-philosophers.qnt"
    main="diningPhilosophersStats"
    invariant="safetyInv"
    max_steps=41
    ;;
  bank)
    spec_path="$example_dir/statistics-live-bank.qnt"
    main="bankStats"
    invariant="totalSupplyInv"
    max_steps=41
    ;;
  paxos)
    spec_path="$example_dir/statistics-live-paxos.qnt"
    main="paxosStats"
    invariant="inv"
    max_steps=25
    ;;
  tendermint)
    spec_path="$example_dir/statistics-live-tendermint.qnt"
    main="tendermintStats"
    invariant="accountabilityInv"
    max_steps=81
    ;;
  tendermint-baseline)
    spec_path="$example_dir/statistics-live-tendermint-baseline.qnt"
    main="tendermintBaselineStats"
    invariant="accountabilityInv"
    max_steps=81
    ;;
  tendermint-fast)
    spec_path="$example_dir/statistics-live-tendermint-fast.qnt"
    main="tendermintFastPathStats"
    invariant="accountabilityInv"
    max_steps=41
    ;;
  lightclient)
    spec_path="$example_dir/statistics-live-lightclient.qnt"
    main="lightclientStats"
    invariant="inv"
    max_steps=12
    ;;
  queue-v1)
    spec_path="$example_dir/statistics-live-queue-v1.qnt"
    main="queuePerfV1Stats"
    invariant="boundsInv"
    max_steps=61
    ;;
  queue-v2)
    spec_path="$example_dir/statistics-live-queue-v2.qnt"
    main="queuePerfV2Stats"
    invariant="boundsInv"
    max_steps=61
    ;;
  *)
    echo "Usage: $(basename "$0") [random-walk|die-hard|two-phase-commit|lamport-mutex|dining-philosophers|bank|paxos|tendermint|tendermint-baseline|tendermint-fast|lightclient|queue-v1|queue-v2] [samples] [seed] [max-steps]" >&2
    exit 1
    ;;
esac

if [[ -n "$custom_max_steps" ]]; then
  max_steps="$custom_max_steps"
fi

if [[ "${QUINT_RAYLIB_SKIP_BUILD:-0}" != "1" ]]; then
  npm --prefix "$quint_dir" run compile >/dev/null
  cargo build --manifest-path "$native_dir/Cargo.toml" >/dev/null
fi

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

bindings_dir="$(mktemp -d "${TMPDIR:-/tmp}/quint-stats-bindings.XXXXXX")"
bindings_path="$bindings_dir/bindings.json"
cleanup() {
  rm -rf "$bindings_dir"
}
trap cleanup EXIT

cat >"$bindings_path" <<EOF
{
  "bindings": [
    {
      "kind": "ffi",
      "module": "statsPortal",
      "name": "tapPortalListener",
      "library": "$library",
      "symbol": "rl_tap_portal_listener_host"
    }
  ]
}
EOF

export QUINT_RAYLIB_TAP_DELAY_MS="${QUINT_RAYLIB_TAP_DELAY_MS:-0}"
export QUINT_RAYLIB_TAP_RENDER_INTERVAL_MS="${QUINT_RAYLIB_TAP_RENDER_INTERVAL_MS:-33}"

exec "$bun_bin" "$quint_dir/dist/src/cli.js" run "$spec_path" \
  --backend=typescript \
  --main="$main" \
  --init=init \
  --step=step \
  --invariant="$invariant" \
  --max-samples="$samples" \
  --max-steps="$max_steps" \
  --seed="$seed" \
  --verbosity=0 \
  --foreign-bindings "$bindings_path" \
  --tap-listener-op statsPortal.tapPortalListener
