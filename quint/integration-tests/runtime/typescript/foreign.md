# TypeScript backend - Bun foreign binding tests

Integration tests for `run`, `test`, and REPL when declaration-only operators are bound through Bun.

<!-- !test program
bash -
-->

### Run supports foreign module bindings under Bun

<!-- !test check foreign run -->
    bun ./dist/src/cli.js run --backend=typescript \
      --foreign-bindings ./testFixture/foreign/module-bindings.json \
      --main foreignModule \
      --max-samples=1 \
      --max-steps=1 \
      --seed=0x1 \
      --invariant=foreignInvariant \
      ./testFixture/foreign/moduleSpec.qnt

### Test supports foreign module bindings under Bun

<!-- !test check foreign test -->
    bun ./dist/src/cli.js test --backend=typescript \
      --foreign-bindings ./testFixture/foreign/module-bindings.json \
      --main foreignModule \
      --max-samples=1 \
      --seed=0x1 \
      ./testFixture/foreign/moduleSpec.qnt

### REPL evaluates foreign bindings under Bun

<!-- !test in foreign repl -->
```
printf "answer\nadd1(41)\n.exit\n" | bun ./dist/src/cli.js --backend=typescript \
  --foreign-bindings ./testFixture/foreign/module-bindings.json \
  -q \
  -r ./testFixture/foreign/moduleSpec.qnt::foreignModule
```

<!-- !test out foreign repl -->
```
42
42
```
