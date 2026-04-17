module twoPhaseCommitStats {
  pure val RM_SET = Set("rm1", "rm2", "rm3")
  pure val REPORT_LIMIT = 20

  import two_phase_commit(resourceManagers = RM_SET) as T from "../classic/distributed/TwoPhaseCommit/two_phase_commit"

  var ticks: int
  var reported: bool

  def decided = T::TM::state != T::Init
  def finished = decided or ticks == REPORT_LIMIT
  def decisionOutcome =
    if (T::TM::state == T::TMCommitted) "commit" else if (T::TM::state == T::TMAborted) "abort" else "timeout"

  action init = all {
    T::init,
    ticks' = 0,
    reported' = false,
  }

  action protocolStep = all {
    not(decided),
    ticks < REPORT_LIMIT,
    T::step,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action report = all {
    finished,
    not(reported),
    q::tap("two_phase_commit.decision_outcome", decisionOutcome) == decisionOutcome,
    q::tap("two_phase_commit.report_steps", ticks) == ticks,
    q::tap("two_phase_commit.prepared_count", T::TM::preparedRMs.size()) == T::TM::preparedRMs.size(),
    T::RM::states' = T::RM::states,
    T::TM::state' = T::TM::state,
    T::TM::preparedRMs' = T::TM::preparedRMs,
    T::messages' = T::messages,
    ticks' = ticks,
    reported' = true,
  }

  action step = any {
    protocolStep,
    report,
  }

  val consistencyInv = T::consistencyInv
}
