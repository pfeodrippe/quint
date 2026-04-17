module diningPhilosophersStats {
  import DiningPhilosophers(N = 5) as T from "../classic/distributed/DiningPhilosophers/DiningPhilosophers5"
  pure val REPORT_LIMIT = 40

  var ticks: int
  var reported: bool

  def someoneEating = T::philosophers.exists(p => T::states.get(p) == T::Eating)
  def finished = someoneEating or ticks == REPORT_LIMIT

  action init = all {
    T::init,
    ticks' = 0,
    reported' = false,
  }

  action protocolStep = all {
    not(someoneEating),
    ticks < REPORT_LIMIT,
    T::step,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action report = all {
    finished,
    not(reported),
    q::tap("dining_philosophers.outcome", if (someoneEating) "ate" else "timeout") == if (someoneEating) "ate" else "timeout",
    q::tap("dining_philosophers.report_steps", ticks) == ticks,
    q::tap("dining_philosophers.active_eaters", T::philosophers.filter(p => T::states.get(p) == T::Eating).size()) ==
      T::philosophers.filter(p => T::states.get(p) == T::Eating).size(),
    T::forks' = T::forks,
    T::taken' = T::taken,
    T::states' = T::states,
    ticks' = ticks,
    reported' = true,
  }

  action step = any {
    protocolStep,
    report,
  }

  val safetyInv = T::Safety
}
