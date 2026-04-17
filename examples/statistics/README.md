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

## Included specs

1. `random_walk_stats.qnt` - Quint version of a TLC-style random-walk statistics example
2. `die_hard_stats.qnt` - Quint version of the classic Die Hard jug puzzle
3. `two_phase_commit_stats.qnt` - statistical wrapper around Quint's Two-Phase Commit example
4. `lamport_mutex_stats.qnt` - statistical wrapper around Quint's Lamport mutex example
5. `dining_philosophers_stats.qnt` - statistical wrapper around Quint's Dining Philosophers example

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

## Notes on interpretation

- `random_walk_stats.qnt` is the clearest analogue to the TLC “simulate a
  stochastic process and measure the distribution” story.
- `die_hard_stats.qnt` is intentionally open to timeout outcomes, so it can be
  used to study solve-rate under bounded random exploration rather than only
  shortest-path reachability.
- `two_phase_commit_stats.qnt`, `lamport_mutex_stats.qnt`, and
  `dining_philosophers_stats.qnt` show the same technique on real distributed
  protocol examples already present in the Quint repository.
