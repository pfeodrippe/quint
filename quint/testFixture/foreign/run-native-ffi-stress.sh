#!/usr/bin/env bash

set -euo pipefail

fixture_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$fixture_dir/../.." && pwd)"
rust_dir="$fixture_dir/native-rust"

case "$(uname -s)" in
  Darwin)
    library="$rust_dir/target/debug/libquint_foreign_add1.dylib"
    ;;
  Linux)
    library="$rust_dir/target/debug/libquint_foreign_add1.so"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    library="$rust_dir/target/debug/quint_foreign_add1.dll"
    ;;
  *)
    echo "Unsupported OS for native ffi fixture: $(uname -s)" >&2
    exit 1
    ;;
esac

calls="${QUINT_FFI_STRESS_CALLS:-1500}"
warmups="${QUINT_FFI_STRESS_WARMUPS:-1}"
repeats="${QUINT_FFI_STRESS_REPEATS:-4}"
max_ratio="${QUINT_FFI_STRESS_MAX_RATIO:-2}"

cd "$project_dir"

cargo build --manifest-path "$rust_dir/Cargo.toml" >/dev/null
npm run compile >/dev/null

scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/quint-native-ffi-stress.XXXXXX")"
trap 'rm -rf "$scratch_dir"' EXIT

node - <<'NODE' "$scratch_dir" "$library" "$calls" "$warmups" "$repeats" "$max_ratio"
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const [dir, library, callsArg, warmupsArg, repeatsArg, maxRatioArg] = process.argv.slice(2)

const calls = Number.parseInt(callsArg, 10)
const warmups = Number.parseInt(warmupsArg, 10)
const repeats = Number.parseInt(repeatsArg, 10)
const maxRatio = Number.parseFloat(maxRatioArg)

if (!Number.isInteger(calls) || calls <= 0) {
  throw new Error(`Invalid QUINT_FFI_STRESS_CALLS: ${callsArg}`)
}

if (!Number.isInteger(warmups) || warmups < 0) {
  throw new Error(`Invalid QUINT_FFI_STRESS_WARMUPS: ${warmupsArg}`)
}

if (!Number.isInteger(repeats) || repeats <= 0) {
  throw new Error(`Invalid QUINT_FFI_STRESS_REPEATS: ${repeatsArg}`)
}

if (!Number.isFinite(maxRatio) || maxRatio <= 0) {
  throw new Error(`Invalid QUINT_FFI_STRESS_MAX_RATIO: ${maxRatioArg}`)
}

const elems = Array.from({ length: calls }, (_, index) => String(index + 1)).join(', ')
const body = `Set(${elems}).fold(0, (acc, _) => add1(acc))`

fs.writeFileSync(
  path.join(dir, 'pure.qnt'),
  `module pureBench {\n  pure def add1(x: int): int = x + 1\n  val result = ${body}\n  val ok = result == ${calls}\n}\n`
)
fs.writeFileSync(
  path.join(dir, 'native.qnt'),
  `module foreignNativeBench {\n  pure def add1(x: int): int\n  val result = ${body}\n  val ok = result == ${calls}\n}\n`
)
fs.writeFileSync(
  path.join(dir, 'bindings.json'),
  JSON.stringify(
    {
      bindings: [
        {
          kind: 'ffi',
          module: 'foreignNativeBench',
          name: 'add1',
          library,
          symbol: 'add1_host',
        },
      ],
    },
    null,
    2
  )
)

function measure(args) {
  const start = process.hrtime.bigint()
  const result = spawnSync('bun', args, {
    cwd: process.cwd(),
    stdio: 'pipe',
    encoding: 'utf8',
  })
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6

  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout)
    }
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
    process.exit(result.status ?? 1)
  }

  return elapsedMs
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const pureArgs = ['./dist/src/cli.js', 'test', '--backend=typescript', '--main', 'pureBench', path.join(dir, 'pure.qnt')]
const nativeArgs = [
  './dist/src/cli.js',
  'test',
  '--backend=typescript',
  '--main',
  'foreignNativeBench',
  '--foreign-bindings',
  path.join(dir, 'bindings.json'),
  path.join(dir, 'native.qnt'),
]

for (let i = 0; i < warmups; i += 1) {
  measure(pureArgs)
  measure(nativeArgs)
}

const pureRuns = []
const nativeRuns = []

for (let i = 0; i < repeats; i += 1) {
  pureRuns.push(measure(pureArgs))
  nativeRuns.push(measure(nativeArgs))
}

const pureMedian = median(pureRuns)
const nativeMedian = median(nativeRuns)
const ratio = nativeMedian / pureMedian

console.log(
  JSON.stringify(
    {
      calls,
      warmups,
      repeats,
      maxRatio,
      pureRuns,
      nativeRuns,
      pureMedian,
      nativeMedian,
      ratio,
    },
    null,
    2
  )
)

if (ratio > maxRatio) {
  process.stderr.write(
    `Native ffi median ${nativeMedian.toFixed(2)}ms exceeded ${maxRatio}x the pure Quint median ${pureMedian.toFixed(2)}ms\n`
  )
  process.exit(1)
}
NODE
