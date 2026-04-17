# Integration tests for Rust backend foreign FFI bindings

Tests in this script verify native `ffi` bindings on the Rust backend using the
same `--foreign-bindings` config file API as the TypeScript backend.

<!-- !test program
bash -
-->

## quint run tests

### Run supports native ffi bindings on the Rust backend

<!-- !test check rust foreign ffi run -->
    bash ./testFixture/foreign/run-rust-backend-ffi.sh run \
      --main foreignNative \
      --max-samples=1 \
      --max-steps=1 \
      --seed=0x1 \
      --invariant=ffiInvariant \
      ./testFixture/foreign/nativeSpec.qnt

## quint test tests

### Test supports native ffi bindings on the Rust backend

<!-- !test check rust foreign ffi test -->
    bash ./testFixture/foreign/run-rust-backend-ffi.sh test \
      --main foreignNative \
      --max-samples=1 \
      --seed=0x1 \
      ./testFixture/foreign/nativeSpec.qnt

## quint repl tests

### REPL evaluates native ffi bindings on the Rust backend

<!-- !test in rust foreign ffi repl -->
```
printf "add1(41)\n.exit\n" | bash ./testFixture/foreign/run-rust-backend-ffi.sh \
  -q \
  -r ./testFixture/foreign/nativeSpec.qnt::foreignNative
```

<!-- !test out rust foreign ffi repl -->
```
42
```
