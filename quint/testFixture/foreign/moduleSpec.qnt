module foreignModule {
  pure def add1(x: int): int
  pure val answer: int

  val foreignInvariant = answer == 42 and add1(41) == 42

  action init = foreignInvariant
  action step = foreignInvariant

  run foreignBindingTest = all {
    assert(answer == 42),
    assert(add1(41) == 42),
  }
}
