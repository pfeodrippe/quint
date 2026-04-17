#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

target=""
keep_count="3"
attempt_limit="32"
start_seed="1"
max_steps=""
out_dir=""
conditions=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      target="${2:-}"
      shift 2
      ;;
    --keep)
      keep_count="${2:-}"
      shift 2
      ;;
    --attempts)
      attempt_limit="${2:-}"
      shift 2
      ;;
    --seed)
      start_seed="${2:-}"
      shift 2
      ;;
    --max-steps)
      max_steps="${2:-}"
      shift 2
      ;;
    --out-dir)
      out_dir="${2:-}"
      shift 2
      ;;
    --where)
      conditions+=("${2:-}")
      shift 2
      ;;
    *)
      echo "Usage: $(basename "$0") --target name --where expr [--where expr ...] [--keep N] [--attempts N] [--seed start] [--max-steps N] [--out-dir path]" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$target" || ${#conditions[@]} -eq 0 ]]; then
  echo "Usage: $(basename "$0") --target name --where expr [--where expr ...] [--keep N] [--attempts N] [--seed start] [--max-steps N] [--out-dir path]" >&2
  exit 1
fi

if [[ -z "$out_dir" ]]; then
  out_dir="$(mktemp -d "${TMPDIR:-/tmp}/quint-interesting-traces.XXXXXX")"
else
  mkdir -p "$out_dir"
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/quint-interesting-traces-work.XXXXXX")"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

index_path="$out_dir/index.json"
matches_json=()
matches_found=0

for ((attempt = 0; attempt < attempt_limit && matches_found < keep_count; attempt++)); do
  seed=$((start_seed + attempt))
  report_path="$work_dir/attempt-$attempt.report.json"
  trace_path="$work_dir/attempt-$attempt.itf.json"
  run_log="$work_dir/attempt-$attempt.log"

  if [[ -n "$max_steps" ]]; then
    if ! LISTENER="stats:json:$report_path" OUT_ITF="$trace_path" N_TRACES=1 VERBOSITY=0 \
      bash "$example_dir/run-stats.sh" "$target" 1 "$seed" "$max_steps" >"$run_log" 2>&1; then
      cat "$run_log" >&2
      exit 1
    fi
  else
    if ! LISTENER="stats:json:$report_path" OUT_ITF="$trace_path" N_TRACES=1 VERBOSITY=0 \
      bash "$example_dir/run-stats.sh" "$target" 1 "$seed" >"$run_log" 2>&1; then
      cat "$run_log" >&2
      exit 1
    fi
  fi

  if node "$example_dir/stats-tools.js" filter "$report_path" "${conditions[@]}"; then
    matches_found=$((matches_found + 1))
    keep_prefix="$(printf 'match-%02d-seed-%d' "$matches_found" "$seed")"
    kept_report="$out_dir/$keep_prefix.stats.json"
    kept_trace="$out_dir/$keep_prefix.itf.json"
    mv "$report_path" "$kept_report"
    mv "$trace_path" "$kept_trace"
    matches_json+=("{\"match\":$matches_found,\"seed\":$seed,\"reportPath\":\"$kept_report\",\"tracePath\":\"$kept_trace\"}")
    printf 'kept %s\n' "$kept_trace"
  else
    rm -f "$report_path" "$trace_path" "$run_log"
  fi
done

if (( matches_found == 0 )); then
  printf '[]\n' >"$index_path"
else
  printf '[\n%s\n]\n' "$(printf '  %s,\n' "${matches_json[@]}" | sed '$ s/,$//')" >"$index_path"
fi

printf 'saved %d matching trace(s) to %s\n' "$matches_found" "$out_dir"
printf 'index: %s\n' "$index_path"
