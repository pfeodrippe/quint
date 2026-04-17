# Statistical properties with Quint

This directory shows the Quint equivalent of the common **TLA+/TLC simulation
statistics** workflow.

In TLC, the usual pattern is:

1. simulate many runs
2. record measurements through scratchpad / CSV side effects
3. post-process the collected data

In Quint, the same idea can be expressed more directly:

1. instrument a spec with `q::tap("label", value)`
2. run many simulations with `--tap-listener stats`
3. let Quint aggregate the samples by label

That keeps the measurement logic in the spec, but the aggregation logic in the
runtime instead of an external CSV script.

## Why this is useful

This style of simulation statistics is useful whenever you care about **behavioral
performance** or **probabilistic outcomes**, not just hard safety violations.

Common uses:

1. **Reliability / success-rate estimation**: what fraction of runs eventually commit, solve, or terminate?
2. **Latency / effort distributions**: how many steps does completion usually take, and what is the p90?
3. **Contention / occupancy**: how large do queues, critical sections, or resource sets get during runs?
4. **Randomized algorithm behavior**: what outcomes show up most often, and how variable are they?
5. **Version-to-version comparison**: did spec v2 actually improve the metric that mattered in v1?

## Included specs

1. `random_walk_stats.qnt` - Quint version of a TLC-style random-walk statistics example
2. `die_hard_stats.qnt` - Quint version of the classic Die Hard jug puzzle
3. `two_phase_commit_stats.qnt` - statistical wrapper around Quint's Two-Phase Commit example
4. `lamport_mutex_stats.qnt` - statistical wrapper around Quint's Lamport mutex example
5. `dining_philosophers_stats.qnt` - statistical wrapper around Quint's Dining Philosophers example
6. `queue_perf_v1_stats.qnt` - queue-drain workload baseline for v1/v2 performance comparison
7. `queue_perf_v2_stats.qnt` - higher-throughput queue-drain revision using the same metrics as v1

Each wrapper emits one measurement set per simulated trace, so the listener
output can be interpreted as a distribution over runs rather than a raw event
log.

## Human-readable summaries

Run all five examples:

```bash
examples/statistics/run-stats.sh all 200 1
```

Run one example:

```bash
examples/statistics/run-stats.sh two-phase-commit 200 1
```

The built-in `stats` listener prints summaries such as:

- integer percentiles and average
- boolean true/false rates
- string and enum frequency tables
- summarized structured-value frequencies

## Per-trace reducers

Sometimes a spec taps the same label many times within a single run. In that
case, plain `stats` aggregates **all events**, not one reduced value per trace.

Use one of the per-trace modes when you want exactly one sample per label per
run:

- `stats:trace:last` - keep the last tapped value in each trace
- `stats:trace:min` - keep the minimum integer value in each trace
- `stats:trace:max` - keep the maximum integer value in each trace
- `stats:trace:count` - count how many times the label was tapped in each trace
- `stats:trace:sum` - sum integer tap values within each trace

For `min`, `max`, and `sum`, only integer-valued labels are aggregated; non-integer
labels are skipped in the reduced report.

Example:

```bash
LISTENER='stats:trace:max' \
examples/statistics/run-stats.sh random-walk 200 1
```

`random_walk_stats.qnt` emits `random_walk.position_each_step` on every walk
step and `random_walk.step_cost_each_step = 1` on every walk step, so:

- `stats` shows the distribution over **all visited positions**
- `stats:trace:last` shows the distribution over **last tapped positions per run**
- `stats:trace:max` shows the distribution over **maximum position reached per run**
- `stats:trace:sum` over `random_walk.step_cost_each_step` matches the total
  **work / steps per run**

## Machine-readable summaries

The same aggregation can be written to JSON:

```bash
LISTENER='stats:json:/tmp/quint-stats.json' \
examples/statistics/run-stats.sh random-walk 200 1
```

Per-trace reducers can also be combined with JSON output:

```bash
LISTENER='stats:trace:last:json:/tmp/quint-trace-stats.json' \
examples/statistics/run-stats.sh random-walk 200 1
```

The JSON file contains one aggregated report with per-label summaries for every
tap label observed during the run.

## Comparing spec v2 against v1

The important pattern is: **instrument both versions with the same labels** and
then compare the resulting distributions.

The queue example pair does exactly that:

- `queue_perf_v1_stats.qnt`
- `queue_perf_v2_stats.qnt`

Both emit the same labels:

- `queue_perf.outcome`
- `queue_perf.report_steps`
- `queue_perf.max_backlog`
- `queue_perf.remaining_work`

Run the comparison helper:

```bash
examples/statistics/compare-queue-versions.sh 400 1
```

That prints a compact v1/v2 comparison for:

1. clear rate
2. average completion steps
3. p90 completion steps
4. average maximum backlog
5. average remaining work at timeout

This is the main workflow for comparing spec revisions:

1. keep the metric labels stable across versions
2. run the same simulation budget and seed policy
3. compare outcome and cost distributions, not just one trace

## Live visualization with raylib

If you want to **watch the distributions evolve in real time**, use the raylib
dashboard:

```bash
examples/foreign/raylib/run-statistics-live.sh random-walk 200 1
examples/foreign/raylib/run-statistics-live.sh queue-v1 200 1
examples/foreign/raylib/run-statistics-live.sh queue-v2 200 1
```

The live dashboard shows:

1. stable per-label metric rows with source locations and cumulative counts
2. running per-label histograms / frequency bars
3. cumulative outcome, step, backlog, and occupancy distributions without a fast-changing event ticker

## Notes on interpretation

- `random_walk_stats.qnt` is the clearest analogue to the TLC “simulate a
  stochastic process and measure the distribution” story.
- `die_hard_stats.qnt` is intentionally open to timeout outcomes, so it can be
  used to study solve-rate under bounded random exploration rather than only
  shortest-path reachability.
- `two_phase_commit_stats.qnt`, `lamport_mutex_stats.qnt`, and
  `dining_philosophers_stats.qnt` show the same technique on real distributed
  protocol examples already present in the Quint repository.
- `queue_perf_v1_stats.qnt` vs `queue_perf_v2_stats.qnt` shows how to compare a
  baseline spec revision against an improved revision using the same metrics.
