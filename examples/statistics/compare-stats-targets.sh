#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

left_target="${1:?Usage: $(basename "$0") <left-target> <right-target> [samples] [seed] [max-steps] }"
right_target="${2:?Usage: $(basename "$0") <left-target> <right-target> [samples] [seed] [max-steps] }"
samples="${3:-400}"
seed="${4:-1}"
max_steps="${5:-}"
left_json="$(mktemp "${TMPDIR:-/tmp}/stats-left.XXXXXX.json")"
right_json="$(mktemp "${TMPDIR:-/tmp}/stats-right.XXXXXX.json")"
left_log="$(mktemp "${TMPDIR:-/tmp}/stats-left-log.XXXXXX.txt")"
right_log="$(mktemp "${TMPDIR:-/tmp}/stats-right-log.XXXXXX.txt")"

cleanup() {
  rm -f "$left_json" "$right_json" "$left_log" "$right_log"
}
trap cleanup EXIT

if ! LISTENER="stats:json:$left_json" bash "$example_dir/run-stats.sh" "$left_target" "$samples" "$seed" "$max_steps" >"$left_log" 2>&1; then
  cat "$left_log" >&2
  exit 1
fi

if ! LISTENER="stats:json:$right_json" bash "$example_dir/run-stats.sh" "$right_target" "$samples" "$seed" "$max_steps" >"$right_log" 2>&1; then
  cat "$right_log" >&2
  exit 1
fi

compare_args=()
if [[ -n "${LABELS:-}" ]]; then
  compare_args+=("--labels=$LABELS")
fi
if [[ -n "${LABEL_PREFIX:-}" ]]; then
  compare_args+=("--prefix=$LABEL_PREFIX")
fi
if [[ -n "${CATEGORY_LIMIT:-}" ]]; then
  compare_args+=("--category-limit=$CATEGORY_LIMIT")
fi

node "$example_dir/stats-tools.js" compare "$left_target" "$left_json" "$right_target" "$right_json" "${compare_args[@]}"
