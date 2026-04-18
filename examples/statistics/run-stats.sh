#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$example_dir/../.." && pwd)"
quint_dir="$repo_dir/quint"
bun_bin="${BUN_BIN:-}"

target="${1:-all}"
samples="${2:-200}"
seed="${3:-1}"
custom_max_steps="${4:-${MAX_STEPS_OVERRIDE:-}}"
listener="${LISTENER:-stats}"
verbosity="${VERBOSITY:-0}"
out_itf="${OUT_ITF:-}"
n_traces="${N_TRACES:-}"

if [[ -z "$bun_bin" ]]; then
  bun_bin="$(command -v bun || true)"
fi

npm --prefix "$quint_dir" run compile >/dev/null

run_example() {
  local name="$1"
  local spec="$2"
  local main="$3"
  local invariant="$4"
  local max_steps="$5"
  local backend="${6:-rust}"
  local runtime="${7:-node}"
  local tap_listener="${8:-$listener}"
  local resolved_max_steps="$max_steps"
  local -a extra_args=()
  local -a command=()

  if [[ -n "$custom_max_steps" ]]; then
    resolved_max_steps="$custom_max_steps"
  fi

  if [[ -n "$n_traces" ]]; then
    extra_args+=("--n-traces=$n_traces")
  fi

  if [[ -n "$out_itf" ]]; then
    extra_args+=("--out-itf" "$out_itf")
  fi

  echo "== $name =="
  command=(
    "$runtime" "$quint_dir/dist/src/cli.js" run "$spec"
    --main="$main"
    --init=init
    --step=step
    --backend="$backend"
    --tap-listener="$tap_listener"
    --max-samples="$samples"
    --max-steps="$resolved_max_steps"
    --seed="$seed"
    --verbosity="$verbosity"
    --invariant="$invariant"
  )
  if ((${#extra_args[@]} > 0)); then
    command+=("${extra_args[@]}")
  fi
  "${command[@]}"
  echo ""
}

case "$target" in
  random-walk)
    run_example \
      "random-walk" \
      "$example_dir/random_walk_stats.qnt" \
      "randomWalkStats" \
      "boundsInv" \
      81
    ;;
  die-hard)
    run_example \
      "die-hard" \
      "$example_dir/die_hard_stats.qnt" \
      "dieHardStats" \
      "boundsInv" \
      401
    ;;
  two-phase-commit)
    run_example \
      "two-phase-commit" \
      "$example_dir/two_phase_commit_stats.qnt" \
      "twoPhaseCommitStats" \
      "consistencyInv" \
      21
    ;;
  lamport-mutex)
    run_example \
      "lamport-mutex" \
      "$example_dir/lamport_mutex_stats.qnt" \
      "lamportMutexStats" \
      "mutexInv" \
      81
    ;;
  dining-philosophers)
    run_example \
      "dining-philosophers" \
      "$example_dir/dining_philosophers_stats.qnt" \
      "diningPhilosophersStats" \
      "safetyInv" \
      41
    ;;
  bank)
    if [[ -z "$bun_bin" ]]; then
      echo "Bun is required for the bank statistics example. Install bun or set BUN_BIN." >&2
      exit 1
    fi
    run_example \
      "bank" \
      "$example_dir/bank_stats.qnt" \
      "bankStats" \
      "totalSupplyInv" \
      41 \
      "typescript" \
      "$bun_bin"
    ;;
  paxos)
    run_example \
      "paxos" \
      "$example_dir/paxos_stats.qnt" \
      "paxosStats" \
      "inv" \
      25
    ;;
  tendermint)
    run_example \
      "tendermint" \
      "$example_dir/tendermint_stats.qnt" \
      "tendermintStats" \
      "accountabilityInv" \
      81
    ;;
  tendermint-baseline)
    run_example \
      "tendermint-baseline" \
      "$example_dir/tendermint_baseline_stats.qnt" \
      "tendermintBaselineStats" \
      "accountabilityInv" \
      81
    ;;
  tendermint-fast)
    run_example \
      "tendermint-fast" \
      "$example_dir/tendermint_fast_path_stats.qnt" \
      "tendermintFastPathStats" \
      "accountabilityInv" \
      41
    ;;
  lightclient)
    run_example \
      "lightclient" \
      "$example_dir/lightclient_stats.qnt" \
      "lightclientStats" \
      "inv" \
      12
    ;;
  queue-v1)
    run_example \
      "queue-v1" \
      "$example_dir/queue_perf_v1_stats.qnt" \
      "queuePerfV1Stats" \
      "boundsInv" \
      61
    ;;
  queue-v2)
    run_example \
      "queue-v2" \
      "$example_dir/queue_perf_v2_stats.qnt" \
      "queuePerfV2Stats" \
      "boundsInv" \
      61
    ;;
  all)
    run_example "random-walk" "$example_dir/random_walk_stats.qnt" "randomWalkStats" "boundsInv" 81
    run_example "die-hard" "$example_dir/die_hard_stats.qnt" "dieHardStats" "boundsInv" 401
    run_example "two-phase-commit" "$example_dir/two_phase_commit_stats.qnt" "twoPhaseCommitStats" "consistencyInv" 21
    run_example "lamport-mutex" "$example_dir/lamport_mutex_stats.qnt" "lamportMutexStats" "mutexInv" 81
    run_example "dining-philosophers" "$example_dir/dining_philosophers_stats.qnt" "diningPhilosophersStats" "safetyInv" 41
    if [[ -z "$bun_bin" ]]; then
      echo "Skipping bank in all-mode because bun is unavailable. Set BUN_BIN to include the bank statistics example." >&2
    else
      run_example "bank" "$example_dir/bank_stats.qnt" "bankStats" "totalSupplyInv" 41 "typescript" "$bun_bin"
    fi
    run_example "paxos" "$example_dir/paxos_stats.qnt" "paxosStats" "inv" 25
    run_example "tendermint" "$example_dir/tendermint_stats.qnt" "tendermintStats" "accountabilityInv" 81
    run_example "tendermint-baseline" "$example_dir/tendermint_baseline_stats.qnt" "tendermintBaselineStats" "accountabilityInv" 81
    run_example "tendermint-fast" "$example_dir/tendermint_fast_path_stats.qnt" "tendermintFastPathStats" "accountabilityInv" 41
    run_example "lightclient" "$example_dir/lightclient_stats.qnt" "lightclientStats" "inv" 12
    run_example "queue-v1" "$example_dir/queue_perf_v1_stats.qnt" "queuePerfV1Stats" "boundsInv" 61
    run_example "queue-v2" "$example_dir/queue_perf_v2_stats.qnt" "queuePerfV2Stats" "boundsInv" 61
    ;;
  *)
    echo "Usage: $(basename "$0") [all|random-walk|die-hard|two-phase-commit|lamport-mutex|dining-philosophers|bank|paxos|tendermint|tendermint-baseline|tendermint-fast|lightclient|queue-v1|queue-v2] [samples] [seed] [max-steps]" >&2
    exit 1
    ;;
esac
