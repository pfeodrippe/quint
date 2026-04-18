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

## Current Tendermint workstream

Goal: stop treating Tendermint as a purely adversarial demo and connect the
stats work to an actual implementation surface.

### Immediate steps

1. Preserve `examples/cosmos/tendermint/Tendermint.qnt` as the canonical
   baseline spec.
2. Put implementation-aligned performance work in an explicit improved variant:
   `examples/cosmos/tendermint/TendermintImproved.qnt`.
3. Make the default `tendermint` statistics path measure that improved variant,
   while keeping the canonical baseline available for comparison.
4. Cross-check any promising spec-side idea against the real CometBFT codebase.

### Real implementation mapping

This repository contains the **Quint spec**, not the production implementation.
The production Tendermint successor lives in:

- `cometbft/cometbft`
- tracked locally in this repository as the submodule `vendor/cometbft`

Relevant implementation files and hot paths:

- `consensus/state.go`
  - `handleMsg`
  - `scheduleTimeout`
  - `enterPropose`
  - `enterPrevote`
  - `defaultDoPrevote`
  - `enterPrecommit`
  - `enterPrevoteWait`
  - `enterPrecommitWait`
- `consensus/reactor.go`
  - consensus message propagation and peer-facing wiring around the state machine

### Constraint

I can validate and improve the Quint-side model in this repository, and I can
map those ideas to the real CometBFT consensus code. I cannot truthfully claim
that real Tendermint/CometBFT performance improved unless the corresponding
change is made and tested against `cometbft/cometbft`.

### Real implementation requirement

The success condition is **not** "the Quint spec got better in isolation".

The real target is:

1. find a Tendermint liveness/performance gain in the Quint statistics runs
2. identify the **same semantic change** in the real CometBFT consensus path
3. apply that change in `cometbft/cometbft`, or confirm that the current
   implementation already contains it
4. measure the real implementation with an A/B comparison that isolates that
   same change

If CometBFT already has the improved behavior, then the correct proof strategy
is not to claim a new implementation patch. Instead, build a local regressed
variant that removes the same behavior and benchmark **current vs regressed**
so we can show that the Quint-side gain was driven by a real implementation
behavior rather than by spec-only modeling.

The tracked workspace for that real-implementation phase is now:

- `vendor/cometbft`

### Progress so far

The first accepted spec-side optimizations now live in the explicit improved
variant:

- `examples/cosmos/tendermint/TendermintImproved.qnt`

The canonical baseline remains:

- `examples/cosmos/tendermint/Tendermint.qnt`

1. `timeoutPropose` is no longer an always-available jump to nil prevote.
2. The model now requires an explicit timeout-expiration step.
3. The nil-prevote path is disabled once the expected proposer's proposal is
    already present.
4. `OnRoundCatchup` now requires future `2/3` prevotes or precommits, matching
   CometBFT's round-skip trigger instead of the older over-approximation.
5. The generic `HasTwoThirdsAny` fallback branches now back off when the current
   round already has a proposal-backed `2/3` majority for a valid value,
   matching CometBFT's stronger `TwoThirdsMajority` path before the weaker
    catch-all vote-set handling.
6. If a process is still in `propose` when the proposal is already present and a
   current-round proposal-backed polka has already formed, it collapses
   directly to precommit instead of spending an extra `prevote` transition,
   matching CometBFT's `handleCompleteProposal()` fast path.
7. If a process catches up into a future round that already has the expected
   proposer proposal and a proposal-backed current-round polka, it collapses
   directly to precommit instead of spending an extra `propose`/`prevote`
   transition. This is now also implemented as a new real CometBFT fast path in
   `enterPropose()`.
8. The real CometBFT slice now buffers future-round proposal messages and their
   block parts instead of dropping them, so the accepted round-catchup fast
   path can fire when proposal data arrives before the node locally skips ahead,
   including skips beyond just the next round.

This improved variant aligns the Quint model with the real CometBFT behavior in:

- `consensus/state.go`
  - `enterPropose`
  - `scheduleTimeout`
  - `handleCompleteProposal`
  - `addVote`
- `consensus/state_test.go`
  - `TestWaitingTimeoutProposeOnNewRound`
  - `TestWaitTimeoutProposeOnNilPolkaForTheCurrentRound`
  - `TestRoundSkipOnNilPolkaFromHigherRound`
  - `TestCommitFromPreviousRound`
  - `TestStartNextHeightCorrectlyAfterTimeout`
  - `TestStateHalt1`

I validated the corresponding CometBFT tests by bootstrapping a temporary Go
toolchain locally and running those consensus tests against a fresh
`cometbft/cometbft` clone.

The tracked real-implementation proof and patch now live in:

- `vendor/cometbft/consensus/state.go`
- `vendor/cometbft/consensus/state_semantic_bench_test.go`

That harness now does six things:

1. it adds semantic regression tests that pin the same "proposal-backed majority
   before generic `HasTwoThirdsAny` fallback" behavior in CometBFT
2. it adds a semantic regression test for proposal completion with an already
   existing current-round proposal-backed polka, matching
   `handleCompleteProposal()`
3. it benchmarks the current-round prevote path through the same useful outcome
   (including the forced timeout hop in the regressed variant) instead of timing
   only the raw final `addVote` call
4. it benchmarks proposal completion with an already existing current-round
   proposal-backed polka through to the same local precommit step
5. it adds and benchmarks a new `enterPropose()` fast path for round-catchup
   cases where the proposal is already complete and a current-round
   proposal-backed polka already exists
6. it adds and benchmarks future-round proposal buffering, so proposal data
   that arrives before a local round skip is preserved and can immediately
   drive the same round-catchup fast path after the skip

Current vs regressed CometBFT result for the accepted Quint change:

- semantic checks:
  - current CometBFT passes
    - `TestProposalBackedPrevoteMajoritySkipsPrevoteWait`
    - `TestProposalBackedPrecommitMajoritySkipsPrecommitWait`
    - `TestProposalCompletionCurrentRoundPolkaSkipsPrevoteStep`
    - `TestEnterProposeCurrentRoundPolkaSkipsPrevoteStep`
    - `TestRoundSkipBufferedProposalPolkaSkipsPrevoteStep`
  - the fallback-first `addVote` regressed variant fails the first two checks
  - the clean `handleCompleteProposal` regressed variant fails the
    proposal-completion check
  - the clean baseline also fails the buffered round-skip proposal checks because
    it ignores future-round proposal data until the proposal is resent after the
    skip
- bounded A/B benchmark (`go test ./consensus -run '^$' -bench '^BenchmarkStateProposalMajorityPrevoteFastPath$' -benchmem -benchtime=500x -count=5 -cpu=1`)
  - current CometBFT: about `81-92 us/op`, `10.7-11.0 KB/op`, `148-149 allocs/op`
  - regressed variant: about `81-95 us/op`, `13.0-13.2 KB/op`, `182-183 allocs/op`
- bounded A/B benchmark for the proposal-completion fast path (`go test ./consensus -run '^$' -bench '^BenchmarkStateHandleCompleteProposalCurrentRoundPolkaFastPath$' -benchmem -benchtime=200x -count=5 -cpu=1`)
  - current CometBFT: about `64-77 us/op`, `14.6 KB/op`, `241 allocs/op`
  - regressed variant: about `100-129 us/op`, `18.7-19.2 KB/op`, `289 allocs/op`
- bounded A/B benchmark for the new `enterPropose()` round-catchup fast path (`go test ./consensus -run '^$' -bench '^BenchmarkStateEnterProposeCurrentRoundPolkaFastPath$' -benchmem -benchtime=200x -count=5 -cpu=1`)
  - patched CometBFT: about `57-75 us/op`, `10.7 KB/op`, `178 allocs/op`
  - clean baseline CometBFT: about `92-116 us/op`, `14.9-15.9 KB/op`, `226 allocs/op`
- bounded A/B benchmark for buffered round-skip proposal handling (`go test ./consensus -run '^$' -bench '^BenchmarkStateRoundSkipBufferedProposalPolkaFastPath$' -benchmem -benchtime=200x -count=5 -cpu=1`)
  - patched CometBFT: about `134-150 us/op`, `17.6-18.2 KB/op`, `278 allocs/op`
  - clean baseline CometBFT: about `132-173 us/op`, `24.1-24.6 KB/op`, `383 allocs/op`
- bounded A/B benchmark for buffered future-round proposal handling (`go test ./consensus -run '^$' -bench '^BenchmarkStateFutureRoundBufferedProposalPolkaFastPath$' -benchmem -benchtime=200x -count=5 -cpu=1`)
  - patched CometBFT: about `112-117 us/op`, `18.3 KB/op`, `290 allocs/op`
  - clean baseline CometBFT: about `137-157 us/op`, `24.7-25.3 KB/op`, `395 allocs/op`

So the same ordering that improved the Quint stats also removes an unnecessary
wait-path in the real implementation, and the regressed implementation pays for
it with materially higher allocation cost and weaker immediate progress.

Follow-up probe that was measured and rejected:

- unlocking on a current-round non-nil polka without a known proposal
  (mirroring CometBFT's unlock-before-nil-precommit path for unknown blocks)
  was implemented as a probe and measured on the same seed-40 runs
  (`400` samples and `2024` samples)
- result: the sampled profile was unchanged from the accepted improved variant
  (`decided=80.46%` at `400`, `decided=82.66%` at `2024`, with the same
  `report_steps`, `max_round_reached`, evidence averages, and terminal-action
  distribution)
- conclusion: this is implementation-aligned behavior, but it does not buy an
  additional measurable Quint gain in the current slice, so it was reverted and
  is not part of the accepted improvement set
- collapsing proposal-processing directly to precommit nil when a current-round
  nil prevote quorum already exists was also implemented as a probe and measured
  on the same seed-40 runs (`400` samples and `2024` samples)
- result: that profile was unchanged from the then-current accepted profile
  (`decided=81.47%` at `400`, `decided=83.65%` at `2024`, with the same
  `report_steps`, `max_round_reached`, evidence averages, and terminal-action
  distribution as the accepted proposal-completion fast path)
- conclusion: this also matches CometBFT semantics, but it does not yield an
  additional measured gain in the current slice, so it was reverted as well
- collapsing proposal completion through an older `validRound`/`POLRound`
  directly to precommit when the current round already had a proposal-backed
  polka was also implemented as a probe and measured on the same seed-40 runs
  (`400` samples and `2024` samples)
- result: it looked positive on `400` samples (`decided=85.24%`,
  `report_steps avg=24.88`, `max_round_reached avg=1.31`) but regressed on the
  `2024`-sample confirmation (`decided=83.81%`, `max_round_reached avg=1.39`,
  worse than the accepted `84.12%` / `1.38` line), so it was reverted
- conclusion: this path is plausible but too unstable in the sampled profile to
  accept as the next spec-driven gain
- advancing from `UponQuorumOfPrecommitsAny` directly to next-round precommit
  when the next round already had the expected proposal and a proposal-backed
  polka was also implemented as a probe and measured on the same seed-40 `400`
  run
- result: it regressed immediately at `400` samples (`decided=81.57%`,
  `report_steps avg=27.27`, `max_round_reached avg=1.54`, with
  `UponQuorumOfPrecommitsAny` rising to `15.40%`), so it was reverted without a
  `2024` confirmation run
- conclusion: targeting the remaining precommit-any tail with another direct
  precommit collapse is too aggressive in this slice
- collapsing `OnRoundCatchup` directly to next-round prevote whenever the
  expected proposal was already present, even without a current-round proposal-
  backed polka, was also implemented as a probe and measured on the same
  seed-40 `400` run
- result: it shortened traces but badly damaged convergence
  (`decided=55.70%`, `report_steps avg=16.52`, `max_round_reached avg=3.28`,
  `OnRoundCatchupWithProposal=9.87%`, `UponQuorumOfPrecommitsAny=27.09%`), so
  it was reverted immediately
- conclusion: reducing steps by spending proposal context too early is not a
  valid spec gain here; the accepted catch-up fast path still needs the
  proposal-backed current-round polka guard

At this point the accepted Quint profile is still the `84.12%` / `25.81` /
`1.38` line. The newer precommit-any and catch-up-only probes also regressed, so
the latest accepted work still extends the real implementation to cover more of
the already-accepted round-catchup behavior rather than claiming a new accepted
spec profile.

Measured effect on the same `2024`-sample, seed `40` run:

- previous snapshot: `decided=10.72%`, `max_round_reached avg=3.79`,
  `report_steps avg=38.13`
- current spec: `decided=84.12%`, `max_round_reached avg=1.38`,
  `report_steps avg=25.81`
- evidence costs improved:
  - `proposal 12.71 -> 2.39`
  - `prevote 16.00 -> 7.92`
  - `precommit 15.27 -> 7.44`
- `UponQuorumOfPrecommitsAny` as the terminal action dropped from `54.74%` to
  `13.02%`
- `OnRoundCatchup` as the terminal action dropped from `34.54%` to `2.51%`
