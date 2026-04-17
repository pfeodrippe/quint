# Statistical properties in Quint: implementation plan

## Problem

TLA+/TLC can be used to obtain statistical properties by simulating many runs,
recording measurements as side effects, and then aggregating them offline. The
current Quint codebase already has:

- random simulation over many samples
- witness counts across traces
- `q::tap(msg, value)` for structured observation events

But it does **not** yet have a first-class way to say:

- collect a measurement across many runs
- summarize it as a distribution / frequency table / min / max / average
- do this directly from the spec without writing an external post-processor

## Research summary

### TLA+/TLC practice

- The TLC/statistical-properties talk (“Obtaining Statistical Properties by Simulating Specs with TLC”) uses simulation to gather measurements like abort rates, convergence rounds, and outcome distributions.
- Existing TLA+ practice relies on TLC scratchpad / CSV side effects (`TLCGet`, `TLCSet`, `CSVWrite`) and then post-processing.
- This is useful, but fairly hacky and tool-specific.

### Quint opportunity

Quint already has a better observation primitive than TLC’s scratchpad:

- `q::tap(msg, value)` is explicit in the language
- tap events already flow through both backends
- listeners can be built into the CLI/runtime

So instead of inventing a separate statistical side-effect API, we can treat
statistical properties as:

1. instrument the spec with `q::tap`
2. attach a `stats` tap listener
3. aggregate tapped samples by label

This is simpler than TLC’s CSV approach, works with existing Quint semantics,
and composes with the direct-listener work already added for raylib.

## Proposed approach

### 1. Add a built-in `stats` tap listener

Support:

```sh
quint run spec.qnt --tap-listener stats
quint run spec.qnt --tap-listener stats:json:/tmp/quint-stats.json
```

Semantics:

- collect every `q::tap(label, value)` event
- group by `label`
- summarize values at the end of the run
- optionally write the aggregated summary as JSON

Initial aggregation policy:

- **int values**:
  - count
  - min
  - max
  - average
  - p50 / p90 / p99
- **bool values**:
  - true count
  - false count
  - true percentage
- **str / enum-like values**:
  - count by value
  - percentages
- **other structured values**:
  - frequency table by normalized serialized value
  - capped output for readability

This gives us useful “statistical property” summaries immediately, without
forcing a new Quint language construct.

### 2. Keep the spec-side API as `q::tap`

Do **not** add a new builtin first.

Reason:

- `q::tap` already exists in both TS and Rust backends
- it already carries label/value/source metadata
- statistical collection can be expressed as “aggregate taps”

This keeps the language small and lets us learn from real usage before adding a
new dedicated builtin like `q::measure` or `q::stats`.

### 3. Add five real spec examples

Create five runnable statistical wrappers so the feature is demonstrated on real
specs instead of one toy example.

Target set:

1. **Two-Phase Commit** (existing Quint classic / TLA+ example)
   - `decision outcome`
   - `decision steps`
2. **Lamport Mutex** (existing Quint classic / TLA+ example)
   - `first entry steps`
3. **Dining Philosophers** (existing Quint classic)
   - `first meal steps`
4. **Random Walk** (new Quint conversion of a TLA+/TLC statistics-style example)
   - absorbing side / position / steps
5. **Die Hard jug puzzle** (new Quint conversion of a classic TLA+ example)
   - solution steps

Each wrapper should:

- preserve the original protocol / puzzle logic
- emit one measurement set per simulated trace
- stop the trace after reporting, so the statistics correspond cleanly to one
  run = one outcome sample

### 4. Document the mapping to TLA+/TLC

Docs should explain:

- TLC style: scratchpad + CSV + post-processing
- Quint style: `q::tap` + `stats` listener
- why this is cleaner and more composable

## Files to change

### Runtime / CLI

- `quint/src/tap.ts`
  - add `stats` listener
  - implement aggregation logic
- `quint/src/cli.ts`
  - document `stats` as a supported tap listener
- `quint/src/builtin.qnt`
  - document statistical use of `q::tap`
- `quint/src/cliReporting.ts`
  - if needed, improve final stats output formatting

### Tests

- `quint/test/tap.test.ts`
  - unit tests for numeric / boolean / string aggregation

### Example

- add five real wrapper specs for statistics
- add a helper script to run each one with `--tap-listener stats`
- update `examples/foreign/raylib/README.md` or another relevant example README
  with the new flow

## Current status

Implemented:

- built-in `stats` listener for human-readable summaries
- built-in `stats:json:<path>` listener for machine-readable summaries
- built-in `stats:trace:last|min|max|count|sum` reducers for per-trace aggregation
- exact Rust trace boundary events so per-trace reducers work on both TS and Rust backends
- five runnable statistical examples under `examples/statistics/`
- example documentation mapping the workflow back to TLA+/TLC simulation
- tests covering numeric, boolean, string, structured, and JSON-output cases

## Implementation steps

1. Add a `stats` tap listener and aggregation helpers in `tap.ts`
2. Add tests covering:
   - numeric summaries
   - booleans
   - categorical strings
3. Wire CLI docs/help text
4. Add the five statistical wrappers
5. Add a runnable helper script
6. Validate on the real examples

## Notes / future work

- A future `q::measure` builtin may still be worthwhile if we want clearer
  intent than `q::tap` for statistics-only use.
- A future labeled reducer API may be useful when different tap labels need
  different per-trace reducers in the same run.

## Ranked next feature wave

The current stats surface is already useful for one target at a time. The next
highest-value work is to turn it into a repeatable **analysis workflow**.

### Highest value

1. **Generic A/B stats diffs**
   - compare any two targets or reports, not just queue v1/v2
   - show deltas for p50/p90/avg and categorical outcome rates
   - include confidence intervals for outcome percentages so comparisons are less hand-wavy
2. **Sweep runner**
   - run the same target across multiple seeds and optional step budgets
   - emit machine-readable summaries plus a compact table for selected labels
   - make it easy to answer “does this trend hold across budgets and seeds?”
3. **Interesting-trace capture**
   - repeatedly run one sample at a time
   - keep only traces whose stats match a filter such as `outcome=INVALID` or
     `verdict_each_step=NOT_ENOUGH_TRUST`
   - bridge from distributions back to debuggable concrete traces

### Medium value

4. **Confidence-interval support in comparison tooling**
   - especially for success / timeout / failure rates
5. **Conditional stat views**
   - e.g. “steps on success only” or “max backlog on timeouts only”
6. **Coverage-style summary rows**
   - action names, rounds reached, coarse state buckets, label presence

### Lower value

7. **Joint-distribution / correlation reports**
   - e.g. rounds vs evidence size, steps vs outcome
8. **Dashboard controls**
   - pause, focus one label, export snapshot JSON, reducer switching
9. **Reusable wrapper helpers**
   - `reportOnce`, max-seen counters, occupancy helpers, standardized outcome labels
10. **First-class spec-parameter sweeps**
    - expose model parameters directly through wrappers instead of only seed/step-budget sweeps

## Current implementation wave

This implementation pass focuses on the top three items above:

1. add reusable runner overrides that higher-level tools can build on
2. add a generic comparison tool with confidence intervals
3. add a sweep runner
4. add interesting-trace capture
5. document the new workflow in the project plan and statistics README
