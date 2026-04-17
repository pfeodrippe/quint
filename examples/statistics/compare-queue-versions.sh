#!/usr/bin/env bash

set -euo pipefail

example_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

samples="${1:-400}"
seed="${2:-1}"
v1_json="$(mktemp "${TMPDIR:-/tmp}/queue-v1-stats.XXXXXX.json")"
v2_json="$(mktemp "${TMPDIR:-/tmp}/queue-v2-stats.XXXXXX.json")"

cleanup() {
  rm -f "$v1_json" "$v2_json"
}
trap cleanup EXIT

LISTENER="stats:json:$v1_json" bash "$example_dir/run-stats.sh" queue-v1 "$samples" "$seed" >/dev/null
LISTENER="stats:json:$v2_json" bash "$example_dir/run-stats.sh" queue-v2 "$samples" "$seed" >/dev/null

node - "$v1_json" "$v2_json" <<'NODE'
const fs = require('fs')

const [v1Path, v2Path] = process.argv.slice(2)
const v1 = JSON.parse(fs.readFileSync(v1Path, 'utf8'))
const v2 = JSON.parse(fs.readFileSync(v2Path, 'utf8'))

const groupsByLabel = report => new Map(report.groups.map(group => [group.label, group]))
const g1 = groupsByLabel(v1)
const g2 = groupsByLabel(v2)

const intAvg = (groups, label) => Number(groups.get(label)?.ints?.avg ?? NaN)
const intP90 = (groups, label) => Number(groups.get(label)?.ints?.p90 ?? NaN)
const stringPct = (groups, label, value) => {
  const entries = groups.get(label)?.strings?.entries ?? []
  const match = entries.find(entry => entry.value === value)
  return match ? Number(match.percentage) : 0
}

const rows = [
  ['clear rate', `${stringPct(g1, 'queue_perf.outcome', 'cleared').toFixed(2)}%`, `${stringPct(g2, 'queue_perf.outcome', 'cleared').toFixed(2)}%`],
  ['avg completion steps', intAvg(g1, 'queue_perf.report_steps').toFixed(2), intAvg(g2, 'queue_perf.report_steps').toFixed(2)],
  ['p90 completion steps', intP90(g1, 'queue_perf.report_steps').toFixed(0), intP90(g2, 'queue_perf.report_steps').toFixed(0)],
  ['avg max backlog', intAvg(g1, 'queue_perf.max_backlog').toFixed(2), intAvg(g2, 'queue_perf.max_backlog').toFixed(2)],
  ['avg remaining work', intAvg(g1, 'queue_perf.remaining_work').toFixed(2), intAvg(g2, 'queue_perf.remaining_work').toFixed(2)],
]

const header = ['metric', 'v1', 'v2']
const widths = [
  Math.max(header[0].length, ...rows.map(row => row[0].length)),
  Math.max(header[1].length, ...rows.map(row => row[1].length)),
  Math.max(header[2].length, ...rows.map(row => row[2].length)),
]

const formatRow = row =>
  row
    .map((value, index) => value.padEnd(widths[index]))
    .join('  ')

console.log(formatRow(header))
console.log(widths.map(width => '-'.repeat(width)).join('  '))
for (const row of rows) {
  console.log(formatRow(row))
}
console.log('')
console.log('Interpretation: queue v2 drains the same stochastic workload with higher service capacity,')
console.log('so it should show a higher clear rate and lower step/backlog distributions than queue v1.')
NODE
