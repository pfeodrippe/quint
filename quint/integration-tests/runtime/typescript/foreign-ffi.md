# TypeScript backend - Bun native ffi foreign binding tests

Integration tests for a real native override built from a tiny Rust `cdylib`.

<!-- !test program
bash -
-->

### Run supports native ffi bindings under Bun

<!-- !test check foreign ffi run -->
    bash ./testFixture/foreign/run-native-ffi.sh run --backend=typescript \
      --main foreignNative \
      --max-samples=1 \
      --max-steps=1 \
      --seed=0x1 \
      --invariant=ffiInvariant \
      ./testFixture/foreign/nativeSpec.qnt

### Test supports native ffi bindings under Bun

<!-- !test check foreign ffi test -->
    bash ./testFixture/foreign/run-native-ffi.sh test --backend=typescript \
      --main foreignNative \
      --max-samples=1 \
      --seed=0x1 \
      ./testFixture/foreign/nativeSpec.qnt

### REPL evaluates native ffi bindings under Bun

<!-- !test in foreign ffi repl -->
```
printf "add1(41)\n.exit\n" | bash ./testFixture/foreign/run-native-ffi.sh \
  --backend=typescript \
  -q \
  -r ./testFixture/foreign/nativeSpec.qnt::foreignNative
```

<!-- !test out foreign ffi repl -->
```
42
```
