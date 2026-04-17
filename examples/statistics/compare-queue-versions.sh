#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

samples="${1:-400}"
seed="${2:-1}"
LABELS="${LABELS:-queue_perf.outcome,queue_perf.report_steps,queue_perf.max_backlog,queue_perf.remaining_work}" \
  bash "$example_dir/compare-stats-targets.sh" queue-v1 queue-v2 "$samples" "$seed"

printf '\n'
printf '%s\n' 'Interpretation: queue v2 drains the same stochastic workload with higher service capacity,'
printf '%s\n' 'so it should show a higher clear rate and lower step/backlog distributions than queue v1.'
