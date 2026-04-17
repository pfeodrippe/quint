#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$example_dir/../.." && pwd)"
quint_dir="$repo_dir/quint"

target="${1:-all}"
samples="${2:-200}"
seed="${3:-1}"
listener="${LISTENER:-stats}"

npm --prefix "$quint_dir" run compile >/dev/null

run_example() {
  local name="$1"
  local spec="$2"
  local main="$3"
  local invariant="$4"
  local max_steps="$5"

  echo "== $name =="
  node "$quint_dir/dist/src/cli.js" run "$spec" \
    --main="$main" \
    --init=init \
    --step=step \
    --backend=rust \
    --tap-listener="$listener" \
    --max-samples="$samples" \
    --max-steps="$max_steps" \
    --seed="$seed" \
    --verbosity=0 \
    --invariant="$invariant"
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
  all)
    run_example "random-walk" "$example_dir/random_walk_stats.qnt" "randomWalkStats" "boundsInv" 81
    run_example "die-hard" "$example_dir/die_hard_stats.qnt" "dieHardStats" "boundsInv" 401
    run_example "two-phase-commit" "$example_dir/two_phase_commit_stats.qnt" "twoPhaseCommitStats" "consistencyInv" 21
    run_example "lamport-mutex" "$example_dir/lamport_mutex_stats.qnt" "lamportMutexStats" "mutexInv" 81
    run_example "dining-philosophers" "$example_dir/dining_philosophers_stats.qnt" "diningPhilosophersStats" "safetyInv" 41
    ;;
  *)
    echo "Usage: $(basename "$0") [all|random-walk|die-hard|two-phase-commit|lamport-mutex|dining-philosophers] [samples] [seed]" >&2
    exit 1
    ;;
esac
