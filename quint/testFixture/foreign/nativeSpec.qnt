module foreignNative {
  pure def add1(x: int): int

  val ffiInvariant = add1(41) == 42

  action init = ffiInvariant
  action step = ffiInvariant

  run nativeBindingTest = all {
    assert(add1(41) == 42),
  }
}
