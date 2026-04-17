# Quint raylib foreign-binding example

This example shows Quint calling a native **raylib** shim through the new
foreign-binding interface.

It includes:

1. `raylib.qnt`: declaration-only Quint operators for a small drawing surface
2. `native-rust/`: a Rust `cdylib` shim that exposes those operators as C ABI symbols
3. `run-raylib-demo.sh`: a helper that builds the Quint CLI, the Rust evaluator,
    and the raylib shim, then launches either a canned demo or a preloaded REPL
4. `bouncing-ball.qnt`: a real Quint state machine that uses the raylib surface
5. `run-bouncing-ball.sh`: a helper that animates the state machine through the REPL
6. `two-phase-commit-live-debug.qnt`: a live dashboard wrapped around the existing two-phase commit protocol spec
7. `run-two-phase-commit-live-debug.sh`: a Rust-backend `quint run` launcher for that dashboard
8. `bank-live-debug.qnt`: a live dashboard wrapped around the existing Cosmos bank spec
9. `run-bank-live-debug.sh`: a Bun + TypeScript `quint run` launcher for that dashboard
10. `trace-debugger.ts`: a post-run raylib trace viewer with trace selection and state stepping
11. `run-bank-trace-debugger.sh`: fast trace capture + viewer for the bank spec
12. `run-two-phase-commit-trace-debugger.sh`: fast trace capture + viewer for the two-phase commit spec
13. `bank-tap-debug.qnt`: a real-spec wrapper that emits structured `q::tap` snapshots
14. `tap-portal.ts`: a standalone raylib viewer for JSONL `q::tap` streams
15. `run-bank-tap-portal.sh`: runs the bank tap wrapper with a direct tap-listener operator that calls into the native Rust raylib shim (no middleman file)

## What this demonstrates

1. a Quint spec can call into a real native graphics library through FFI
2. the shim can keep state behind the foreign-call boundary
3. the same `--foreign-bindings` file API works with the **Rust backend**
4. Quint does **not** need to initialize or present the window directly; the shim owns that
5. a live visual debugger can be driven from a normal `quint run`, not just from the REPL
6. specs that rely on large integers can use the Bun-backed TypeScript evaluator while still using the same foreign-binding API
7. traces can be captured first and inspected afterwards, so simulation is not slowed down by rendering
8. `q::tap` can stream structured values into multiple listeners, including a Portal-style raylib app

## Important caveat

This is intentionally an **escape-hatch example**. The Quint declarations are
`pure`, but the native shim performs side effects by opening a window and
drawing into it. That is useful for experimentation, but it is not a good fit
for proof-oriented or semantics-preserving modeling.

## Run the canned demo

From the repository root:

```sh
bash ./examples/foreign/raylib/run-raylib-demo.sh
```

That opens a small raylib window, draws a simple frame loop for a few seconds,
and closes it.

You need a local desktop session for that part. In headless environments the
build succeeds, but the actual windowed demo may block or fail when raylib
tries to create the window.

You can choose a different number of frames:

```sh
bash ./examples/foreign/raylib/run-raylib-demo.sh 360
```

## Open a preloaded REPL

```sh
bash ./examples/foreign/raylib/run-raylib-demo.sh repl
```

Then you can drive the window directly from Quint:

```quint
rlSetCounter(7)
rlDrawText("Hello from Quint", 180, 120, 30, 255, 255, 255)
rlDrawCircle(400, 280, 70, 0, 121, 241)
rlWindowShouldClose
rlCloseWindow
```

The first draw or counter call opens the window automatically. `rlSetCounter(n)`
updates a persistent `Counter: n` label in the top-left corner, and each draw
or counter call repaints the retained scene immediately on the native side.

There are a few extra helpers for dashboard-style rendering:

```quint
rlClearScene()
rlDrawTextInt("tick ", 12, 20, 60, 24, 255, 255, 255)
rlDrawRect(100, 200, 40, 80, 0, 121, 241)
rlSleepMillis(40)
```

## Visualize a real spec

`bouncing-ball.qnt` is a proper state machine with:

1. `init`
2. `step`
3. `scene`
4. `drawCurrentState`

Run the animated version:

```sh
bash ./examples/foreign/raylib/run-bouncing-ball.sh
```

Or open the state machine in a preloaded REPL:

```sh
bash ./examples/foreign/raylib/run-bouncing-ball.sh repl
```

Then drive it like this:

```quint
init
drawCurrentState
step
drawCurrentState
scene
```

## Debug a real spec with normal `quint run` on Rust

`two-phase-commit-live-debug.qnt` wraps the existing
`examples/classic/distributed/TwoPhaseCommit/two_phase_commit.qnt` model in a
visual dashboard. It shows:

1. the transaction-manager state
2. each resource manager state (`Working`, `Prepared`, `Committed`, `Aborted`)
3. sampled prepare / commit / abort counts
4. the last sampled actor and action
5. whether the protocol consistency invariant still holds

Run it like this:

```sh
bash ./examples/foreign/raylib/run-two-phase-commit-live-debug.sh
```

You can change the number of simulated steps and the random seed:

```sh
bash ./examples/foreign/raylib/run-two-phase-commit-live-debug.sh 180 7
```

This path does **not** use the REPL. It is a normal `quint run` with
`--init=liveInit` and `--step=liveStep`, where the step action renders the
current state before sleeping briefly.

## Debug a big-int spec with Bun + TypeScript

`bank-live-debug.qnt` wraps the existing `examples/cosmos/bank/bank.qnt` model
in a visual dashboard. This one intentionally uses the **TypeScript backend via
Bun**, because the bank spec depends on integer widths that the Rust evaluator
does not currently execute.

It shows:

1. balances per account and denomination
2. successful vs failed sampled transfers
3. the last sampled operation (`from`, `to`, `denom`, `amount`)
4. whether the total-supply invariant still holds

Run it like this:

```sh
bash ./examples/foreign/raylib/run-bank-live-debug.sh
```

You can change the number of simulated steps and the random seed:

```sh
bash ./examples/foreign/raylib/run-bank-live-debug.sh 180 7
```

If Bun is not on your `PATH`, point the script at it explicitly:

```sh
BUN_BIN=/path/to/bun bash ./examples/foreign/raylib/run-bank-live-debug.sh
```

## Trace debugger: capture fast, inspect later

The live dashboards above render during execution. If you want a **real trace debugger**
without slowing the simulator down, use the post-run debugger scripts instead.

These scripts:

1. run Quint normally with `--out-itf` and `--n-traces`
2. capture several completed traces as ITF files
3. open a raylib viewer afterwards

The viewer lets you:

1. switch between traces with **Up/Down**
2. step through states with **Left/Right**
3. jump faster with **PgUp/PgDn**
4. jump to the ends with **Home/End**

### Bank trace debugger

```sh
bash ./examples/foreign/raylib/run-bank-trace-debugger.sh
```

Optional arguments:

```sh
bash ./examples/foreign/raylib/run-bank-trace-debugger.sh <trace-count> <max-samples> <max-steps> <seed>
```

Example:

```sh
bash ./examples/foreign/raylib/run-bank-trace-debugger.sh 16 100 30 7
```

### Two-phase commit trace debugger

```sh
bash ./examples/foreign/raylib/run-two-phase-commit-trace-debugger.sh
```

Optional arguments:

```sh
bash ./examples/foreign/raylib/run-two-phase-commit-trace-debugger.sh <trace-count> <max-samples> <max-steps> <seed>
```

## Tap portal: Portal-style viewing for `q::tap`

Quint now has `q::tap(message, value)` plus the `q::tap(expr)` shorthand, matching
`q::debug`'s ergonomics while still behaving like a value-preserving `tap>`:
it emits the label, value, and source location metadata to every configured listener
and then returns the value unchanged.

From the CLI you can attach sink listeners such as:

```sh
quint run spec.qnt --tap-listener stdout
quint run spec.qnt --tap-listener jsonl:/tmp/quint-taps.jsonl
```

You can also attach a **direct operator listener** under the TypeScript backend:

```sh
bun quint/dist/src/cli.js run spec.qnt \
  --foreign-bindings ./bindings.json \
  --tap-listener-op MyModule.tapListener
```

That operator is invoked directly for every tap event, so it can talk to Bun
modules, WASM, or native raylib FFI without a middleman file. The JSONL route is still
useful for generic post-processing or external consumers.

### Bank tap portal

This uses the real Cosmos bank spec and attaches a **direct native raylib tap
listener operator** through `--tap-listener-op`, so each `q::tap` event is sent
into the Rust shim and rendered there.

```sh
bash ./examples/foreign/raylib/run-bank-tap-portal.sh
```

Optional arguments:

```sh
bash ./examples/foreign/raylib/run-bank-tap-portal.sh <max-steps> <seed>
```

The direct listener is intentionally more `q::debug`-like than the JSONL portal:
it keeps a live list of recent taps on the left and the latest tapped value on
the right.
