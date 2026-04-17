#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

left_name="${1:?Usage: $(basename "$0") <left-name> <left-report.json> <right-name> <right-report.json> }"
left_report="${2:?Usage: $(basename "$0") <left-name> <left-report.json> <right-name> <right-report.json> }"
right_name="${3:?Usage: $(basename "$0") <left-name> <left-report.json> <right-name> <right-report.json> }"
right_report="${4:?Usage: $(basename "$0") <left-name> <left-report.json> <right-name> <right-report.json> }"

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

node "$example_dir/stats-tools.js" compare "$left_name" "$left_report" "$right_name" "$right_report" "${compare_args[@]}"
