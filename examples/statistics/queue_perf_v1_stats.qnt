module queuePerfV1Stats {
  pure val REPORT_LIMIT = 60
  pure val START_BACKLOG = 6
  pure val ARRIVALS = Set(0, 1, 2)
  pure val SERVICE_CAPACITY = 1

  var backlog: int
  var maxBacklog: int
  var ticks: int
  var reported: bool

  def cleared = backlog == 0
  def finished = cleared or ticks == REPORT_LIMIT

  def nextBacklog(arrivals) = {
    val afterService = if (backlog >= SERVICE_CAPACITY) backlog - SERVICE_CAPACITY else 0
    afterService + arrivals
  }

  action init = all {
    backlog' = START_BACKLOG,
    maxBacklog' = START_BACKLOG,
    ticks' = 0,
    reported' = false,
  }

  action protocolStep(arrivals: int): bool = all {
    not(cleared),
    ticks < REPORT_LIMIT,
    backlog' = q::tap("queue_perf.backlog_each_step", nextBacklog(arrivals)),
    maxBacklog' = if (nextBacklog(arrivals) > maxBacklog) nextBacklog(arrivals) else maxBacklog,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action report = all {
    finished,
    not(reported),
    q::tap("queue_perf.version", "v1") == "v1",
    q::tap("queue_perf.outcome", if (cleared) "cleared" else "timeout") == if (cleared) "cleared" else "timeout",
    q::tap("queue_perf.report_steps", ticks) == ticks,
    q::tap("queue_perf.max_backlog", maxBacklog) == maxBacklog,
    q::tap("queue_perf.remaining_work", backlog) == backlog,
    backlog' = backlog,
    maxBacklog' = maxBacklog,
    ticks' = ticks,
    reported' = true,
  }

  action step = any {
    nondet arrivals = ARRIVALS.oneOf()
    protocolStep(arrivals),
    report,
  }

  val boundsInv = and {
    backlog >= 0,
    maxBacklog >= START_BACKLOG,
    maxBacklog >= backlog,
  }
}
