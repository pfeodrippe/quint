#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

targets=""
samples="200"
seeds="1"
max_steps_values="default"
labels=""
out_json=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --targets)
      targets="${2:-}"
      shift 2
      ;;
    --samples)
      samples="${2:-}"
      shift 2
      ;;
    --seeds)
      seeds="${2:-}"
      shift 2
      ;;
    --max-steps)
      max_steps_values="${2:-}"
      shift 2
      ;;
    --labels)
      labels="${2:-}"
      shift 2
      ;;
    --out-json)
      out_json="${2:-}"
      shift 2
      ;;
    *)
      echo "Usage: $(basename "$0") --targets t1,t2 [--samples N] [--seeds a,b] [--max-steps default,10,20] --labels l1,l2 [--out-json path]" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$targets" || -z "$labels" ]]; then
  echo "Usage: $(basename "$0") --targets t1,t2 [--samples N] [--seeds a,b] [--max-steps default,10,20] --labels l1,l2 [--out-json path]" >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/quint-stats-sweep.XXXXXX")"
manifest_path="$work_dir/manifest.json"
run_log="$work_dir/run.log"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

manifest_entries=()

IFS=',' read -r -a target_list <<<"$targets"
IFS=',' read -r -a seed_list <<<"$seeds"
IFS=',' read -r -a step_list <<<"$max_steps_values"

run_index=0
for target in "${target_list[@]}"; do
  for seed in "${seed_list[@]}"; do
    for max_steps in "${step_list[@]}"; do
      run_index=$((run_index + 1))
      report_path="$work_dir/report-$run_index.json"
      seed_trimmed="$(echo "$seed" | xargs)"
      target_trimmed="$(echo "$target" | xargs)"
      step_trimmed="$(echo "$max_steps" | xargs)"

      if [[ "$step_trimmed" == "default" || -z "$step_trimmed" ]]; then
        if ! LISTENER="stats:json:$report_path" bash "$example_dir/run-stats.sh" "$target_trimmed" "$samples" "$seed_trimmed" >"$run_log" 2>&1; then
          cat "$run_log" >&2
          exit 1
        fi
      else
        if ! LISTENER="stats:json:$report_path" bash "$example_dir/run-stats.sh" "$target_trimmed" "$samples" "$seed_trimmed" "$step_trimmed" >"$run_log" 2>&1; then
          cat "$run_log" >&2
          exit 1
        fi
      fi

      case_name="${target_trimmed}/seed=${seed_trimmed}/steps=${step_trimmed:-default}"
      manifest_entries+=("{\"caseName\":\"$case_name\",\"target\":\"$target_trimmed\",\"seed\":$seed_trimmed,\"maxSteps\":\"${step_trimmed:-default}\",\"reportPath\":\"$report_path\"}")
    done
  done
done

printf '[\n%s\n]\n' "$(printf '  %s,\n' "${manifest_entries[@]}" | sed '$ s/,$//')" >"$manifest_path"

args=("$manifest_path" "--labels=$labels")
if [[ -n "$out_json" ]]; then
  args+=("--out-json=$out_json")
fi

node "$example_dir/stats-tools.js" sweep "${args[@]}"
