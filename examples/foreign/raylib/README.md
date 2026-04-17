# Quint raylib foreign-binding example

This example shows Quint calling a native **raylib** shim through the new
foreign-binding interface.

It includes:

1. `raylib.qnt`: declaration-only Quint operators for a small drawing surface
2. `native-rust/`: a Rust `cdylib` shim that exposes those operators as C ABI symbols
3. `run-raylib-demo.sh`: a helper that builds the Quint CLI, the Rust evaluator,
   and the raylib shim, then launches either a canned demo or a preloaded REPL

## What this demonstrates

1. a Quint spec can call into a real native graphics library through FFI
2. the shim can keep state behind the foreign-call boundary
3. the same `--foreign-bindings` file API works with the **Rust backend**
4. Quint does **not** need to initialize the window directly; the shim owns that

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
rlPresent(30, 30, 48)
rlWindowShouldClose
rlCloseWindow
```

`rlSetCounter(n)` updates a persistent `Counter: n` label that the shim draws in
the top-left corner on every presented frame.
