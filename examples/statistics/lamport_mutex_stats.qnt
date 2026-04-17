module lamportMutexStats {
  import LamportMutex(N = 3, maxClock = 6) as T from "../classic/distributed/LamportMutex/LamportMutex"
  pure val REPORT_LIMIT = 80

  var ticks: int
  var reported: bool

  def entered = T::crit != Set()
  def finished = entered or ticks == REPORT_LIMIT

  action init = all {
    T::Init,
    ticks' = 0,
    reported' = false,
  }

  action protocolStep = all {
    not(entered),
    ticks < REPORT_LIMIT,
    T::Next,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action report = all {
    finished,
    not(reported),
    q::tap("lamport_mutex.outcome", if (entered) "entered" else "timeout") == if (entered) "entered" else "timeout",
    q::tap("lamport_mutex.report_steps", ticks) == ticks,
    q::tap("lamport_mutex.critical_size", T::crit.size()) == T::crit.size(),
    T::clock' = T::clock,
    T::req' = T::req,
    T::ack' = T::ack,
    T::crit' = T::crit,
    T::network' = T::network,
    ticks' = ticks,
    reported' = true,
  }

  action step = any {
    protocolStep,
    report,
  }

  val mutexInv = T::Mutex
}
