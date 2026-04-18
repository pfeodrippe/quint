# Tendermint spec-driven real performance report

## Goal

The goal of this work was not just to make the Quint Tendermint model look
better in isolation. The goal was:

1. find a statistically measurable Tendermint improvement in the Quint spec,
2. make sure that improvement is implementation-aligned,
3. carry the same semantic change into real CometBFT code, and
4. measure a real runtime gain there.

This report describes what was changed, why it was expected to help real
software, how the spec-side gain was measured, how it was mapped into
`vendor/cometbft`, and what real implementation gains were observed.

## Executive summary

The accepted spec-side performance gain was:

- **`OnRoundCatchupWithProposalPolka`** in
  `examples/cosmos/tendermint/TendermintImproved.qnt`

Its core idea is:

- if a process catches up into a future round,
- and that future round already has the expected proposer's proposal,
- and that same round already has a proposal-backed `2/3` prevote quorum,
- then the process should not waste an extra `propose -> prevote` cycle,
- it should go directly to `precommit`.

That was expected to produce a real performance gain because the same condition
also exists in CometBFT's consensus state machine: once the node already has the
proposal plus a proposal-backed majority, the remaining extra hop is redundant
work. In the real implementation that redundant work means more state-machine
steps, more message handling, more allocations, and more time before the node
can locally advance.

The result was twofold:

1. **The Quint spec improved materially** on the accepted `2024`-sample,
   seed-`40` run.
2. **The real CometBFT implementation got faster on the corresponding hot
   paths**, with focused benchmark wins typically in the **20-40%** range and
   sizable allocation reductions.

## Scope of the accepted work

The Tendermint workstream produced an explicit implementation-aligned improved
variant:

- `examples/cosmos/tendermint/TendermintImproved.qnt`

The canonical baseline remains:

- `examples/cosmos/tendermint/Tendermint.qnt`

The improved variant includes these accepted model changes:

1. `timeoutPropose` is modeled as its own event, and the nil-prevote path is
   blocked once the expected proposer's proposal is already present.
2. round catch-up is only allowed on future `2/3` prevotes or precommits,
   instead of the older over-approximation.
3. generic `HasTwoThirdsAny`-style fallback branches do not fire when the
   current round already has a proposal-backed majority for a valid value.
4. if a process is in `propose` and already has both the proposal and a
   current-round proposal-backed polka, it collapses directly to `precommit`.
5. if a process catches up into a future round that already has the expected
   proposer proposal and a proposal-backed polka, it collapses directly to
   `precommit` via `OnRoundCatchupWithProposalPolka`.

The work that turned this into a **real implementation** gain then landed in:

- `vendor/cometbft/consensus/state.go`
- `vendor/cometbft/consensus/state_semantic_bench_test.go`

## Why this spec change was expected to help the real implementation

The accepted fast path was not a model-only simplification. It was based on a
real consensus-state observation:

- a node can locally arrive in a round **after** proposal and vote information
  for that round has already propagated,
- the node may already have the proposal,
- the node may already have enough prevotes to know there is a proposal-backed
  polka,
- but the default state-machine path still forces it through another local
  transition sequence before it can precommit.

That is exactly the kind of situation where a spec-level reduction in state
transitions can predict a real implementation gain:

1. **less redundant local work**: fewer transitions through `propose` and
   `prevote`,
2. **less waiting on already-known information**: the node reuses evidence it
   already has,
3. **lower allocation pressure**: fewer transient objects and fewer state
   updates on the hot path,
4. **better immediate progress**: the node reaches the useful next step faster.

This hypothesis was strengthened by the shape of the bad-tail statistics:

- before the accepted improvement, too many runs terminated in
  `UponQuorumOfPrecommitsAny` and `OnRoundCatchup`,
- the model was spending too much effort in rounds that already had enough
  information to move forward,
- the accepted fast path directly targeted that redundant tail.

## How the spec was measured

### Measurement mechanism

The statistics work uses Quint's `q::tap(...)` instrumentation together with the
built-in `stats` tap listener documented in:

- `examples/statistics/README.md`

The relevant workflow is:

1. instrument the spec wrappers with `q::tap("label", value)`,
2. run many randomized traces,
3. aggregate one report across all traces,
4. compare reports across variants.

The main helper used for Tendermint was:

```bash
examples/statistics/run-stats.sh tendermint <samples> <seed>
```

For machine-readable reports:

```bash
LISTENER='stats:json:/tmp/tendermint.json' \
examples/statistics/run-stats.sh tendermint 2024 40
```

For report-to-report comparison:

```bash
LABEL_PREFIX=tendermint. \
examples/statistics/compare-stats-reports.sh before /tmp/before.json after /tmp/after.json
```

For drilling into tails with concrete traces:

```bash
examples/statistics/capture-interesting-traces.sh \
  tendermint \
  --where 'tendermint.last_action=UponQuorumOfPrecommitsAny'
```

### What was measured in the spec

The Tendermint statistical wrapper records per-trace summaries such as:

- `tendermint.outcome`
- `tendermint.report_steps`
- `tendermint.max_round_reached`
- `tendermint.decided_processes`
- `tendermint.proposal_evidence`
- `tendermint.prevote_evidence`
- `tendermint.precommit_evidence`
- `tendermint.last_action`
- `tendermint.accountability_holds`

These metrics matter for performance-oriented reasoning:

- **`outcome=decided`** tells whether the run converged,
- **`report_steps`** is the per-trace work/latency proxy,
- **`max_round_reached`** captures how much round-churn occurred,
- **evidence counts** approximate protocol effort and message pressure,
- **`last_action`** shows where the remaining bad tails are concentrated.

### Spec-side decision rule

A spec change was only treated as accepted when it:

1. looked better on an exploratory run,
2. still held on the larger **`2024`-sample, seed `40`** confirmation run, and
3. remained clearly implementation-aligned.

Several candidate probes were rejected because they either:

- were flat,
- improved only at `400` samples but regressed at `2024`, or
- reduced steps in a way that actually harmed convergence.

## What was measured in the spec

### Accepted profile

The accepted Quint profile for the current implementation-aligned variant is:

- `decided=84.12%`
- `report_steps avg=25.81`
- `max_round_reached avg=1.38`
- `proposal_evidence avg=2.39`
- `prevote_evidence avg=7.92`
- `precommit_evidence avg=7.44`

The accepted fast path that most directly drove the real work was:

- `OnRoundCatchupWithProposalPolka`

### Improvement over the earlier snapshot

On the same `2024`-sample, seed `40` run:

| Metric | Earlier snapshot | Accepted improved variant |
| --- | --- | --- |
| `decided` | `10.72%` | `84.12%` |
| `max_round_reached avg` | `3.79` | `1.38` |
| `report_steps avg` | `38.13` | `25.81` |
| `proposal_evidence avg` | `12.71` | `2.39` |
| `prevote_evidence avg` | `16.00` | `7.92` |
| `precommit_evidence avg` | `15.27` | `7.44` |
| terminal `UponQuorumOfPrecommitsAny` | `54.74%` | `13.02%` |
| terminal `OnRoundCatchup` | `34.54%` | `2.51%` |

This was not interpreted as "the model got shorter, therefore the software is
faster." The important part was **why** the profile improved:

- it improved by eliminating redundant progress hops in places where the node
  already had enough evidence to advance.

That is the exact kind of improvement that can plausibly carry into a real
consensus engine.

## How the accepted spec behavior was turned into real CometBFT work

Two real implementation hooks were added so the accepted spec behavior would
actually exist in `vendor/cometbft`.

### 1. `enterPropose()` direct-precommit fast path

File:

- `vendor/cometbft/consensus/state.go`

Semantic idea:

- when `enterPropose()` is entered for a round whose proposal is already
  complete,
- and the current round already has a proposal-backed polka,
- jump directly to `precommit` instead of doing another useless extra step.

This is the real analogue of the accepted spec-side collapse where proposal
context plus proposal-backed majority already exist.

Pinned by:

- `TestEnterProposeCurrentRoundPolkaSkipsPrevoteStep`
- `BenchmarkStateEnterProposeCurrentRoundPolkaFastPath`

### 2. Future-round proposal buffering

Files:

- `vendor/cometbft/consensus/state.go`

Relevant code areas:

- `futureProposalBuffers`
- `enterNewRound(...)`
- `defaultSetProposal(...)`
- `addProposalBlockPart(...)`

Semantic idea:

- if proposal messages or block parts for a future round arrive before the node
  locally skips into that round,
- do not discard them,
- buffer them and reuse them after the round skip.

This was necessary because the accepted Quint fast path assumes the proposal is
already available when the node catches up. Without buffering, real CometBFT
could miss that opportunity simply because proposal data arrived "too early" for
the node's local round number.

Pinned by:

- `TestRoundSkipBufferedProposalPolkaSkipsPrevoteStep`
- `BenchmarkStateRoundSkipBufferedProposalPolkaFastPath`
- `TestFutureRoundBufferedProposalPolkaSkipsPrevoteStep`
- `BenchmarkStateFutureRoundBufferedProposalPolkaFastPath`

## How the real implementation was measured

The real side was not measured with broad end-to-end throughput claims. It was
measured with **focused semantic tests and bounded microbenchmarks** against the
consensus hot paths that correspond to the accepted spec behavior.

That was done in:

- `vendor/cometbft/consensus/state_semantic_bench_test.go`

The main benchmark commands recorded for this work were:

```bash
go test ./consensus -run '^$' -bench '^BenchmarkStateHandleCompleteProposalCurrentRoundPolkaFastPath$' -benchmem -benchtime=200x -count=5 -cpu=1

go test ./consensus -run '^$' -bench '^BenchmarkStateEnterProposeCurrentRoundPolkaFastPath$' -benchmem -benchtime=200x -count=5 -cpu=1

go test ./consensus -run '^$' -bench '^BenchmarkStateRoundSkipBufferedProposalPolkaFastPath$' -benchmem -benchtime=200x -count=5 -cpu=1

go test ./consensus -run '^$' -bench '^BenchmarkStateFutureRoundBufferedProposalPolkaFastPath$' -benchmem -benchtime=200x -count=5 -cpu=1
```

Two kinds of comparisons were used:

1. **patched vs clean baseline**
   - compare the modified `vendor/cometbft` tree against a clean baseline tree
2. **current vs regressed variant**
   - intentionally remove the fast path in a local comparison variant and show
     that the semantic tests fail or the hot path gets slower / more expensive

This matters because the whole point was to prove that the spec gain corresponded
to a real implementation behavior, not to claim a speedup from an unrelated code
change.

## Real implementation results

### Proposal-majority and proposal-completion path

#### `BenchmarkStateProposalMajorityPrevoteFastPath`

| Variant | Time | Memory | Allocs |
| --- | --- | --- | --- |
| current CometBFT | `81-92 us/op` | `10.7-11.0 KB/op` | `148-149 allocs/op` |
| regressed variant | `81-95 us/op` | `13.0-13.2 KB/op` | `182-183 allocs/op` |

Interpretation:

- time was roughly similar,
- but the accepted ordering materially reduced memory and allocation cost.

#### `BenchmarkStateHandleCompleteProposalCurrentRoundPolkaFastPath`

| Variant | Time | Memory | Allocs |
| --- | --- | --- | --- |
| current CometBFT | `64-77 us/op` | `14.6 KB/op` | `241 allocs/op` |
| regressed variant | `100-129 us/op` | `18.7-19.2 KB/op` | `289 allocs/op` |

Interpretation:

- about **23-50% faster**,
- about **23% less memory**,
- about **17% fewer allocations**.

### Round-catchup fast path

#### `BenchmarkStateEnterProposeCurrentRoundPolkaFastPath`

| Variant | Time | Memory | Allocs |
| --- | --- | --- | --- |
| patched CometBFT | `57-75 us/op` | `10.7 KB/op` | `178 allocs/op` |
| clean baseline CometBFT | `92-116 us/op` | `14.9-15.9 KB/op` | `226 allocs/op` |

Interpretation:

- about **18-51% faster**,
- about **30% less memory**,
- about **21% fewer allocations**.

This is the closest direct real implementation counterpart to the accepted
spec-side `OnRoundCatchupWithProposalPolka` behavior.

### Buffered round-skip proposal reuse

#### `BenchmarkStateRoundSkipBufferedProposalPolkaFastPath`

| Variant | Time | Memory | Allocs |
| --- | --- | --- | --- |
| patched CometBFT | `134-150 us/op` | `17.6-18.2 KB/op` | `278 allocs/op` |
| clean baseline CometBFT | `132-173 us/op` | `24.1-24.6 KB/op` | `383 allocs/op` |

Interpretation:

- time improved modestly and inconsistently,
- but memory dropped by about **27%**,
- allocations dropped by about **27%**.

### Buffered future-round proposal reuse

#### `BenchmarkStateFutureRoundBufferedProposalPolkaFastPath`

| Variant | Time | Memory | Allocs |
| --- | --- | --- | --- |
| patched CometBFT | `112-117 us/op` | `18.3 KB/op` | `290 allocs/op` |
| clean baseline CometBFT | `137-157 us/op` | `24.7-25.3 KB/op` | `395 allocs/op` |

Interpretation:

- about **14-29% faster**,
- about **27% less memory**,
- about **27% fewer allocations**.

## How spec measurement and real measurement were connected

The important connection was semantic, not just directional:

1. **Spec-side observation**
   - too many runs were wasting effort in catch-up and generic precommit-any
     tails
2. **Accepted spec fast path**
   - when proposal context plus proposal-backed majority already exist, skip the
     redundant extra local hops
3. **Real-side code mapping**
   - teach `enterPropose()` to take the same shortcut
   - preserve future-round proposal data so that shortcut is actually reachable
4. **Real-side proof**
   - add semantic tests that fail on the clean baseline
   - benchmark the hot path before and after

That chain is what makes this report a real spec-driven performance story rather
than a loose "the model improved and we also changed some Go code" story.

## Rejected probes and why they were not carried forward

Not every shorter-looking spec trace was accepted.

Rejected probes included:

1. a POL-round completion fast path that looked good at `400` samples but
   regressed on the `2024` confirmation,
2. a direct `UponQuorumOfPrecommitsAny -> next-round precommit` collapse that
   regressed to `decided=81.57%`, `report_steps avg=27.27`,
   `max_round_reached avg=1.54`,
3. a direct `OnRoundCatchup -> prevote when proposal already exists` collapse
   that shortened traces but badly damaged convergence
   (`decided=55.70%`, `max_round_reached avg=3.28`).

This rejection process was important. It kept the work honest:

- no probe was accepted unless it improved the larger confirmation run,
- and no real implementation patch was treated as the next win unless the spec
  had already justified it.

## Future measurements to deepen validation and find new wins

The current work proves that the accepted spec gain maps to real implementation
hot-path improvements. The next measurement wave should do two things:

1. strengthen the "real world" proof for Tendermint/CometBFT specifically,
2. turn this into a reusable spec-driven performance workflow for other specs.

### Tendermint-specific future measurements

#### 1. Measure fast-path hit rate in realistic runs

The current benchmarks show that the patched paths are faster **when hit**. The
next question is how often real nodes hit them under realistic network
conditions.

Useful measurements:

- count how often `enterPropose()` takes the proposal-backed polka fast path,
- count how often buffered future proposals are later consumed after a round
  skip,
- count how often buffered proposal data is dropped unused,
- correlate these counts with round number, timeout events, and decision
  latency.

Why it matters:

- this turns the current "hot path is faster" proof into an estimate of how much
  it should matter in live deployments.

#### 2. Run bounded multi-node end-to-end CometBFT scenarios

The current evidence is hot-path level. The next step is a controlled
multi-node benchmark where the same scenarios that motivated the spec change are
deliberately induced.

Useful measurements:

- end-to-end decision latency across a small cluster,
- rounds-to-decision distribution,
- message counts per decision,
- CPU time and allocation totals per node,
- latency difference between:
  - normal delivery,
  - proposal-arrives-before-round-skip,
  - delayed proposal completion,
  - future-round proposal buffering cases.

Why it matters:

- this would convert the local consensus-step gain into a broader operational
  performance statement.

#### 3. Compare different network/adversarial profiles against the same labels

The accepted gain is most likely to matter under partial asynchrony, skewed
message arrival, or mild disruption rather than perfectly clean runs.

Useful measurements:

- rerun the Tendermint spec and real benchmarks under profiles with:
  - delayed proposal delivery,
  - delayed block parts,
  - vote-heavy but proposal-light scheduling,
  - benign future-round message early arrival,
  - one faulty or equivocating participant vs cleaner runs.

Why it matters:

- it would show where the optimization has the highest leverage and where it is
  mostly irrelevant.

#### 4. Add conditional measurements around bad tails

The current spec already showed that `UponQuorumOfPrecommitsAny` and
`OnRoundCatchup` were the important tails. That pattern can be pushed further.

Useful measurements:

- `report_steps | outcome=decided`,
- `report_steps | last_action=UponQuorumOfPrecommitsAny`,
- `max_round_reached | future proposal was already present`,
- evidence counts conditioned on whether a fast path fired,
- terminal-action distribution after applying each candidate probe.

Why it matters:

- averages alone can hide whether a change improves the successful majority or
  merely shortens failing traces.

#### 5. Instrument real CometBFT with the same conceptual labels as the spec

Right now the spec and real implementation are linked by reasoning and
benchmarks. A stronger bridge would use mirrored counters and events.

Useful measurements:

- "proposal already present on round entry",
- "proposal-backed polka already present on round entry",
- "fast path taken",
- "future proposal buffered",
- "future proposal buffer consumed after round skip",
- "entered generic fallback instead of strong-majority branch".

Why it matters:

- it would let the spec and implementation be compared with nearly the same
  observables instead of only manually aligned stories.

### General measurement patterns for other specs

The same approach can be reused well beyond Tendermint. The general rule is:

- do not optimize for fewer steps in the abstract,
- optimize for removing redundant work that corresponds to a real
  implementation branch.

#### 1. Measure progress funnels, not only final outcomes

For most protocols and state machines, useful performance diagnostics come from
tracking the stages that precede success or failure.

Examples:

- queueing specs: enqueued -> scheduled -> processed -> drained,
- replication specs: proposed -> accepted -> committed -> applied,
- lock/service specs: requested -> granted -> used -> released,
- retry workflows: attempted -> backed off -> retried -> completed.

Useful measurements:

- per-stage residence time,
- how often runs loop back to earlier stages,
- which stage most often appears as the terminal or penultimate action.

Why it matters:

- it reveals the actual bottleneck branch instead of only saying "version B used
  fewer steps".

#### 2. Measure work proxies that can map to implementation cost

Raw step count is useful, but it is stronger when paired with domain-level work
metrics.

Examples:

- messages sent,
- messages buffered,
- retries performed,
- items scanned,
- queue backlog,
- lock-contention depth,
- proposals or blocks reprocessed,
- quorum checks performed.

Why it matters:

- these are often much easier to map into CPU, allocation, or IO cost in the
  real implementation.

#### 3. Use tail-focused trace capture as a first-class perf tool

The trace-capture workflow used here should be considered part of the
performance method, not just a debugging convenience.

General pattern:

1. find the slow or non-converging tail with aggregate stats,
2. capture only traces that match that tail,
3. read concrete traces to identify redundant transitions,
4. propose only implementation-aligned changes,
5. rerun the same statistical comparison.

Why it matters:

- the best performance gains usually come from fixing the tail behavior, not
  from making already-good runs slightly shorter.

#### 4. Require confirmation runs, not just exploratory wins

This Tendermint work already showed why this matters: some probes looked good at
`400` samples and then failed at `2024`.

Reusable rule:

1. use a small exploratory run to generate candidates,
2. use a larger fixed-seed confirmation run before accepting anything,
3. reject unstable probes even if they look locally promising.

Why it matters:

- it prevents overfitting to one sample batch.

#### 5. Always pair accepted spec gains with one of two real-side proofs

For any future spec-driven perf work, an accepted spec gain should produce one
of these:

1. **new implementation patch**
   - the real system was missing the same behavior, and the patch adds it
2. **current-vs-regressed proof**
   - the real system already had the behavior, and a regressed comparison shows
     why it matters

Why it matters:

- it keeps the work honest and prevents claiming "real perf relevance" without a
  real implementation counterpart.

#### 6. Prefer mirrored measurement labels across spec and implementation

When possible, define the spec-side labels so they can later be mirrored in the
real codebase.

Good examples:

- `outcome`,
- `rounds_reached`,
- `messages_buffered`,
- `fallback_taken`,
- `fast_path_taken`,
- `items_reprocessed`,
- `retries_before_success`.

Why it matters:

- it dramatically lowers the friction of proving that a spec-side win is the
  same phenomenon as a real-side win.

## Current status

What is already achieved:

- a stable accepted Quint Tendermint profile at
  `84.12%` decided / `25.81` avg report steps / `1.38` avg max round,
- a concrete spec-side explanation for why redundant catch-up hops are expensive,
- real CometBFT fast paths that realize that accepted behavior,
- focused real implementation benchmark wins on the corresponding hot paths.

What is not yet achieved:

- a newer accepted spec-driven gain beyond the currently landed round-catchup
  and proposal-buffering work,
- a single end-to-end node-throughput percentage for full CometBFT operation.

So the honest bottom line is:

- **yes, the accepted spec change was used to drive real implementation
  improvements,**
- **yes, those real improvements were measured and are material,**
- **and no, later candidate probes did not beat the current accepted frontier,
  so they were reverted rather than overstated.**
