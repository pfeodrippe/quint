module randomWalkStats {
  pure val LIMIT = 4
  pure val REPORT_LIMIT = 80

  var position: int
  var ticks: int
  var reported: bool

  def absorbed = position == LIMIT or position == -LIMIT
  def finished = absorbed or ticks == REPORT_LIMIT
  def absorbingSide =
    if (position == LIMIT) "right" else if (position == -LIMIT) "left" else "timeout"

  action init = all {
    position' = 0,
    ticks' = 0,
    reported' = false,
  }

  action walk = all {
    not(absorbed),
    ticks < REPORT_LIMIT,
    nondet delta = Set(-1, 1).oneOf()
    position' = q::tap("random_walk.position_each_step", position + delta),
    ticks' = ticks + q::tap("random_walk.step_cost_each_step", 1),
    reported' = reported,
  }

  action report = all {
    finished,
    not(reported),
    q::tap("random_walk.outcome", absorbingSide) == absorbingSide,
    q::tap("random_walk.final_position", position) == position,
    q::tap("random_walk.report_steps", ticks) == ticks,
    position' = position,
    ticks' = ticks,
    reported' = true,
  }

  action step = any {
    walk,
    report,
  }

  val boundsInv = and {
    position >= -LIMIT,
    position <= LIMIT,
  }
}
