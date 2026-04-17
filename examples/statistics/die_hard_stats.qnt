module dieHardStats {
  /// Quint conversion of the classic 5-gallon / 3-gallon Die Hard jug puzzle
  /// often used in TLA+ statistical-simulation material.

  pure val bigCapacity = 5
  pure val smallCapacity = 3
  pure val REPORT_LIMIT = 400

  var big: int
  var small: int
  var ticks: int
  var reported: bool

  def solved = big == 4
  def finished = solved or ticks == REPORT_LIMIT

  action init = all {
    big' = 0,
    small' = 0,
    ticks' = 0,
    reported' = false,
  }

  action fillBig = all {
    not(solved),
    ticks < REPORT_LIMIT,
    big < bigCapacity,
    big' = bigCapacity,
    small' = small,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action fillSmall = all {
    not(solved),
    ticks < REPORT_LIMIT,
    small < smallCapacity,
    big' = big,
    small' = smallCapacity,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action emptyBig = all {
    not(solved),
    ticks < REPORT_LIMIT,
    big > 0,
    big' = 0,
    small' = small,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action emptySmall = all {
    not(solved),
    ticks < REPORT_LIMIT,
    small > 0,
    big' = big,
    small' = 0,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action pourBigToSmall = all {
    not(solved),
    ticks < REPORT_LIMIT,
    big > 0,
    small < smallCapacity,
    big' = if (big + small <= smallCapacity) 0 else big - (smallCapacity - small),
    small' = if (big + small <= smallCapacity) big + small else smallCapacity,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action pourSmallToBig = all {
    not(solved),
    ticks < REPORT_LIMIT,
    small > 0,
    big < bigCapacity,
    small' = if (big + small <= bigCapacity) 0 else small - (bigCapacity - big),
    big' = if (big + small <= bigCapacity) big + small else bigCapacity,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action report = all {
    finished,
    not(reported),
    q::tap("die_hard.outcome", if (solved) "solved" else "timeout") == if (solved) "solved" else "timeout",
    q::tap("die_hard.report_steps", ticks) == ticks,
    q::tap("die_hard.final_big", big) == big,
    q::tap("die_hard.remaining_small", small) == small,
    big' = big,
    small' = small,
    ticks' = ticks,
    reported' = true,
  }

  action step = any {
    fillBig,
    fillSmall,
    emptyBig,
    emptySmall,
    pourBigToSmall,
    pourSmallToBig,
    report,
  }

  val boundsInv = and {
    big >= 0,
    big <= bigCapacity,
    small >= 0,
    small <= smallCapacity,
  }
}
