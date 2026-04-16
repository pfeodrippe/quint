# Quint Bun-first foreign operator implementation plan

## Objective

Add **fast, in-process** operator overrides to Quint so a Quint specification can declare an operator in Quint and execute it through:

1. **TypeScript/JavaScript** host code loaded directly in-process
2. **Rust/Zig/native** host code exposed as shared libraries and called through **Bun.ffi**
3. **Wasm** host code loaded directly in-process through Bun's runtime facilities

The implemented sequence was:

1. first make Quint build and run under **Bun** with behavior parity
2. then add **Bun-native foreign operator dispatch**

There is **no subprocess command binding path** in this implementation direction.

## Why this plan changed

The original exploration plan used a generalized binding model with a slower RPC/process boundary option. That is no longer the chosen direction.

The current user direction is:

1. optimize for the **fastest practical execution path**
2. move Quint toward **Bun** first
3. then add **Bun FFI**

So the project plan is now Bun-first and in-process-first.

## Current repository baseline

### Confirmed facts

1. Quint currently has **no operator-level foreign-call implementation**.
2. Existing override support is **instance constant substitution**, not external operator execution.
3. The parser already accepts **operator headers without bodies**, but currently lowers them to a fake `true` expression.
4. Quint is currently a **Node/npm** project:
   - `quint/package.json` declares `node >= 18`
   - scripts are written in npm style
   - tests use `mocha` + `ts-node`
5. Runtime evaluation currently flows through:
   - `quint/src/runtime/impl/builder.ts`
   - `quint/src/runtime/impl/evaluator.ts`
6. Bun parity has already been proven locally for compile/test flows in this repo.

### Completed work so far

1. Deep repository and RFC research completed.
2. In-repo implementation plan created.
3. Declaration-only operator support has already been implemented across parser/IR/printing/type/effect layers.
4. Quint now compiles under Bun and the existing test suite passes under Bun and Node.
5. A first Bun-only foreign binding slice is now implemented for declaration-only pure defs/vals through:
   - `module` bindings
   - `ffi` bindings via `Bun.ffi`
   - `wasm` bindings via Bun module loading
6. CLI plumbing for `run`, `test`, and REPL now accepts a foreign bindings config.
7. Runtime dispatch now fails explicitly when declaration-only defs are evaluated without a binding.

### Current implementation status

1. **Done:** declaration-only operator groundwork
2. **Done:** Bun compile/test parity
3. **Done:** Bun-only foreign binding loader and evaluator dispatch
4. **Done:** config validation, runtime guardrails, and explicit error codes
5. **Done:** unit coverage for `module`, `ffi`, and `wasm` adapters
6. **Done:** Bun CLI integration coverage for `run`, `test`, and REPL
7. **Done:** repo fixtures and user-facing documentation for the Bun-first slice

## Target architecture

## Foreign operator declaration style

Quint foreign operators use **typed operator headers without bodies**:

```quint
module Crypto {
  pure def sha256(bytes: List[int]): str
}
```

That syntax is still the cleanest surface because:

1. the grammar already supports it
2. it is explicit in the spec
3. it gives the type/effect system something concrete to reason about

## Binding model

The binding model is now entirely **in-process**.

### Binding kinds

| kind | target | execution model |
| --- | --- | --- |
| `module` | TS/JS | Bun loads a module and calls the exported function directly |
| `ffi` | Rust/Zig/native | Bun calls a shared-library symbol through `Bun.ffi` |
| `wasm` | Wasm | Bun loads a Wasm module directly and invokes its exported function |

There is **no `command` binding** in this plan.

## Fast-path design rules

1. First slice is restricted to **pure** operators only.
2. Only **declaration-only** operators may be externally implemented in the first slice.
3. Foreign dispatch is only supported in the **Bun runtime path**.
4. Unsupported runtimes or unsupported operator kinds must fail explicitly.
5. No silent fallback to fake bodies, subprocesses, or generic slow paths.

## Scope

### In scope

1. Bun compatibility work needed to make Quint compile and run under Bun.
2. Declaration-only operator stabilization.
3. Bun runtime plumbing for foreign operator dispatch.
4. JS/TS module bindings.
5. Bun.ffi bindings for native shared libraries.
6. Direct Wasm bindings.
7. Tests and docs for the Bun-first path.

### Out of scope

1. Rust evaluator backend support for foreign overrides.
2. Verification semantics for foreign operators in Apalache/TLC.
3. Effectful or stateful foreign operators.
4. Async host calls in the first slice.
5. Subprocess or JSON-RPC fallback paths.

## File-by-file implementation map

| Area | Files | Why they matter |
| --- | --- | --- |
| IR/parser | `quint/src/ir/quintIr.ts`, `quint/src/parsing/ToIrListener.ts`, `quint/src/ir/IRVisitor.ts`, `quint/src/ir/IRTransformer.ts`, `quint/src/ir/IRprinting.ts`, `quint/src/graphics.ts` | Represent declaration-only operators and stop fake-body behavior |
| Analysis | `quint/src/types/constraintGenerator.ts`, `quint/src/effects/inferrer.ts`, `quint/src/effects/modeChecker.ts` | Infer types/effects from annotations and enforce purity restrictions |
| Build/runtime migration | `quint/package.json`, maybe lockfiles, test scripts, compile scripts | Make the project run under Bun with parity |
| CLI/runtime entrypoints | `quint/src/cli.ts`, `quint/src/cliCommands.ts`, `quint/src/repl.ts` | Thread Bun runtime setup and binding config into run/test/repl |
| Runtime dispatch | `quint/src/runtime/impl/builder.ts`, `quint/src/runtime/impl/evaluator.ts` | Intercept operator application and dispatch to Bun-backed implementations |
| New foreign runtime layer | `quint/src/runtime/foreign.ts` | Keep Bun-specific loading/FFI/Wasm logic isolated |
| Value conversion | `quint/src/itf.ts` and/or new codec helpers | Convert Quint values to host-call payloads and back |
| Error codes | `quint/src/quintError.ts` | Add explicit Bun/FFI/Wasm binding failures |
| Tests | `quint/test/...` and integration coverage | Verify Bun compatibility and foreign dispatch correctness |
| Docs | `README.md` and docs pages | Explain Bun runtime, shared-library expectations, and Wasm usage |

## Detailed execution plan

This section is now a **completed execution checklist** for the Bun-first scope.

Every phase below is implemented for the current feature boundary:

1. declaration-only pure operators
2. Bun-only TypeScript backend execution
3. synchronous `module`, `ffi`, and `wasm` bindings
4. `run`, `test`, and REPL integration
5. unit, integration, and documentation coverage

## Phase 1: stabilize declaration-only operators

### Goal

Finish the work already started so declaration-only operators are a reliable base for Bun-backed host implementations.

### Tasks

1. Mark header-only defs in IR with `declarationOnly`.
2. Keep placeholder bodies only as compatibility scaffolding where required by the current IR shape.
3. Ensure visitors skip fake bodies for declaration-only defs.
4. Ensure printers omit fake `= true` bodies.
5. Ensure type inference derives operator types from annotations.
6. Ensure effect inference derives safe effect shapes from annotations.
7. Ensure declaration-only defs without annotations fail clearly.
8. Repair and extend parser/type/effect/printer tests around this behavior.

### Acceptance criteria

1. `pure def hash(x: int): int` parses and prints correctly.
2. Type/effect inference succeeds without evaluating a fake body.
3. Runtime never accidentally treats the placeholder body as executable logic.

## Phase 2: install Bun locally and establish build parity

### Goal

Get Bun available locally and prove that Quint can compile under Bun before foreign-operator work continues.

### Tasks

1. Install Bun in a **local, non-global** location for this task.
2. Record the local Bun path and invocation strategy.
3. Run:
   - compile
   - targeted tests
   - full test suite if feasible
   - format/lint checks
4. Identify Bun incompatibilities in:
   - npm script assumptions
   - ts-node usage
   - Mocha execution
   - package manager/lockfile expectations
   - Node stdlib behavior differences
5. Make the smallest possible project changes to achieve Bun parity without breaking existing behavior.

### Acceptance criteria

1. Quint compiles under Bun.
2. Core tests pass under Bun.
3. If any remaining incompatibilities exist, they are documented explicitly in the repo plan.

## Phase 3: establish runtime parity under Bun

### Goal

Ensure the evaluator and CLI behaviors match under Bun closely enough that Bun can become the execution host for foreign operators.

### Tasks

1. Validate CLI entrypoints under Bun:
   - `parse`
   - `typecheck`
   - `compile`
   - `run`
   - `test`
   - REPL
2. Validate TypeScript evaluator behavior under Bun.
3. Check Node-API assumptions that Bun only partially emulates.
4. Fix any runtime-level incompatibilities in:
   - REPL I/O
   - filesystem access
   - child process use still required elsewhere in the repo
   - path resolution
   - serialization behavior
5. Preserve current output and error behavior unless Bun forces a deliberate change.

### Acceptance criteria

1. The TypeScript evaluator path works under Bun.
2. `run`, `test`, and REPL behave correctly enough to host foreign operator execution.

## Phase 4: define Bun foreign binding schema

### Goal

Define a Bun-first binding format that can target TS modules, native libraries, and Wasm modules.

### Implemented config shape

```json
{
  "bindings": [
    {
      "module": "Crypto",
      "name": "sha256_ts",
      "kind": "module",
      "path": "./foreign/crypto.ts",
      "export": "sha256"
    },
    {
      "module": "Crypto",
      "name": "sha256_native",
      "kind": "ffi",
      "library": "./native/libcrypto_host.dylib",
      "symbol": "sha256_host"
    },
    {
      "module": "Crypto",
      "name": "sha256_wasm",
      "kind": "wasm",
      "path": "./foreign/crypto.wasm",
      "export": "sha256"
    }
  ]
}
```

### Tasks

1. Add a CLI option for the bindings file.
2. Define validation rules for all three binding kinds.
3. Resolve each binding against analyzed declarations.
4. Require:
   - target exists
   - target is a `def`
   - target is `declarationOnly`
   - target qualifier is allowed in the first slice
5. Reject duplicate bindings.
6. Normalize resolved bindings into a runtime registry keyed by operator definition id.

### Acceptance criteria

1. A valid config resolves cleanly.
2. Invalid configs fail early and clearly.

## Phase 5: implement TS/JS module bindings

### Goal

Provide the fastest and simplest in-process path for TypeScript/JavaScript implementations.

### Tasks

1. Create a `module` binding adapter under `quint/src/runtime/foreign/`.
2. Resolve module paths relative to config location or cwd.
3. Load the module in Bun.
4. Resolve the requested export.
5. Validate the export is callable.
6. Define the call signature Quint uses internally.
7. Convert Quint arguments/results to the internal binding codec.

### Acceptance criteria

1. A declaration-only Quint operator can be implemented by an in-process JS/TS function.

## Phase 6: implement Bun.ffi native bindings

### Goal

Provide a high-performance path for Rust/Zig/native code through shared libraries and `Bun.ffi`.

### Design note

Bun.ffi is appropriate for **shared libraries with C-compatible ABIs**. In practice, Rust/Zig implementations use a small exported shim layer instead of calling arbitrary binaries directly.

### Tasks

1. Define the native ABI contract for Quint foreign operators.
2. Decide the first-slice marshaling approach for native FFI:
   - simplest acceptable ABI for arguments/results
   - likely string/buffer-based or pointer-based encoding boundary
3. Build an `ffi` binding adapter using `Bun.ffi`.
4. Load the shared library.
5. Resolve and validate the symbol.
6. Marshal arguments into the native ABI.
7. Invoke the symbol.
8. Convert the return value back into Quint values.
9. Add strict validation around ABI mismatches.

### Acceptance criteria

1. A declaration-only Quint operator can be implemented by a Rust/Zig/shared-library symbol via Bun.ffi.

## Phase 7: implement Wasm bindings

### Goal

Support Wasm directly without using the discarded subprocess path.

### Design note

Wasm is **not** the same as Bun.ffi. The implemented path uses Bun's Wasm/runtime support directly rather than pretending Wasm is a native shared-library ABI.

### Tasks

1. Define the Wasm binding contract.
2. Decide how values cross the Wasm boundary in the first slice.
3. Build a `wasm` binding adapter.
4. Load the Wasm module directly in Bun.
5. Resolve and validate the exported function.
6. Marshal values in/out safely.

### Acceptance criteria

1. A declaration-only Quint operator can be implemented by a Wasm export loaded directly in-process.

## Phase 8: integrate runtime dispatch

### Goal

Route eligible operator applications to Bun-backed implementations instead of Quint bodies.

### Tasks

1. Thread the resolved binding registry into evaluator creation.
2. Update evaluator creation sites used by:
   - `run`
   - `test`
   - REPL
3. In `builder.ts`, intercept operator application for user-defined operators whose definition id is present in the foreign registry.
4. Evaluate arguments normally first.
5. Dispatch to the proper adapter:
   - `module`
   - `ffi`
   - `wasm`
6. Convert the host result back into a Quint runtime value.
7. Preserve tracing/error behavior where possible.
8. Ensure unbound declaration-only operators fail explicitly.

### Acceptance criteria

1. Bound declaration-only operators execute in-process.
2. Existing non-foreign operators continue to behave correctly.

## Phase 9: guardrails

### Goal

Keep the first slice fast but safe enough not to corrupt evaluator semantics silently.

### Tasks

1. Restrict first slice to supported pure operator qualifiers only.
2. Reject unsupported backends explicitly.
3. Reject malformed bindings and malformed host return values explicitly.
4. Reject non-declaration-only targets.
5. Reject bodyful operators being externally rebound in this first slice.
6. Ensure runtime failures surface with clear Quint errors.

### Acceptance criteria

1. There is no silent fallback to fake bodies or hidden slow paths.

## Phase 10: tests

### Bun compatibility tests

1. compile under Bun
2. selected unit tests under Bun
3. TypeScript evaluator smoke tests under Bun

### Declaration-only operator tests

1. parse
2. print
3. type inference
4. effect inference
5. missing annotation failure

### Binding validation tests

1. unknown operator
2. duplicate binding
3. target has body
4. unsupported qualifier
5. malformed config

### Module binding tests

1. scalar return
2. structured return
3. invalid export failure

### FFI binding tests

1. native symbol call succeeds
2. bad symbol failure
3. ABI mismatch failure

### Wasm binding tests

1. Wasm export call succeeds
2. bad export failure
3. invalid value conversion failure

### Runtime integration tests

1. `quint run` under Bun with a foreign operator
2. `quint test` under Bun with a foreign operator
3. REPL under Bun with a foreign operator

## Phase 11: documentation

### Tasks

1. Document the Bun-first runtime requirement for foreign operator support.
2. Document how to declare foreign operators in Quint.
3. Document `module` bindings for TS/JS.
4. Document `ffi` bindings for Rust/Zig/native shared libraries.
5. Document `wasm` bindings.
6. Add examples for all three binding kinds.
7. Document first-slice limitations clearly.

## Implemented runtime layout

```text
quint/src/runtime/foreign.ts
quint/src/runtime/impl/builder.ts
quint/src/runtime/impl/evaluator.ts
quint/src/itf.ts
```

The current implementation keeps Bun-specific loading/FFI/Wasm logic concentrated in `quint/src/runtime/foreign.ts`, while `builder.ts` and `evaluator.ts` handle dispatch and wiring.

## Error handling plan

Add explicit failures for:

1. Bun runtime missing when foreign bindings are requested
2. bindings file unreadable
3. bindings file malformed
4. target operator not found
5. target operator has a body and cannot be externally overridden
6. target operator qualifier unsupported
7. module export not found
8. shared library load failure
9. native symbol resolution failure
10. Wasm module load failure
11. Wasm export resolution failure
12. host result not representable in Quint
13. declaration-only operator called without a binding

## Risk register

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Bun is not fully drop-in for this repo | Build/runtime parity may need real fixes | Prove compile/test/runtime parity before adding foreign dispatch |
| FFI ABI design becomes too complex | Rust/Zig/native interop can explode in scope | Start with a narrow ABI and pure functions only |
| Wasm value marshaling is awkward | Wasm is not the same as native FFI | Use a dedicated Wasm adapter, not the FFI adapter |
| Native code can crash the process | Bun.ffi is in-process native execution | Keep first slice narrow and validate aggressively |
| Existing evaluator behavior regresses under Bun | Migration risk affects the whole CLI/runtime path | Preserve parity first, then add foreign operator dispatch |

## Acceptance criteria for the overall feature

The Bun-first foreign operator slice is complete when:

1. Quint compiles and runs correctly under Bun for the target workflows.
2. A declaration-only pure operator can be implemented by a TS/JS module.
3. A declaration-only pure operator can be implemented by a Rust/Zig/native shared library via Bun.ffi.
4. A declaration-only pure operator can be implemented by a Wasm module loaded directly in Bun.
5. `run`, `test`, and the REPL can all execute those operators under Bun.
6. Unsupported cases fail explicitly and clearly.

## Current work order

The Bun-first foreign operator slice described in this plan has been implemented.

There are no remaining in-scope implementation tasks in this plan.

The following are intentionally **out of scope**, not incomplete:

1. future expansion beyond the current pure/synchronous slice
2. richer platform-specific native/Wasm example artifacts checked into the repo
3. any discarded subprocess/command path work

## Current status snapshot

| Workstream | Status | Notes |
| --- | --- | --- |
| Research | done | Repository and RFC direction understood |
| Declaration-only operators | done | Parser/IR/printing/type/effect layers treat header-only defs as first-class declarations |
| Bun installation | done | Local Bun installation used to validate compile/test/integration flows |
| Bun build parity | done | Quint compiles and tests successfully under Bun |
| Bun runtime parity | done | TypeScript evaluator, `run`, `test`, and REPL work under Bun |
| Bun FFI/native bindings | done | `ffi` bindings load Bun FFI symbols with explicit error handling and tests |
| Wasm bindings | done | `wasm` bindings load Bun-resolved exports with explicit error handling and tests |
| Docs/tests | done | Unit coverage, Bun CLI integration coverage, repo fixtures, and user docs are in place |
