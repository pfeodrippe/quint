module tendermintBaselineStats {
  pure val REPORT_LIMIT = 80

  import TendermintTest(
    Corr = Set("p1", "p2", "p3"),
    Faulty = Set("p4"),
    N = 4,
    T = 1,
    ValidValues = Set("v0", "v1"),
    InvalidValues = Set("v2"),
    MaxRound = 4,
    Proposer = Map(0 -> "p1", 1 -> "p2", 2 -> "p3", 3 -> "p4", 4 -> "p1")
  ) as T from "../cosmos/tendermint/TendermintTest"

  var ticks: int
  var reported: bool

  def decidedCount = T::Corr.filter(p => T::decision.get(p) != T::NilValue).size()

  def distinctDecisionCount =
    T::Corr.fold(Set(), (decisions, process) =>
      if (T::decision.get(process) == T::NilValue) {
        decisions
      } else {
        decisions.union(Set(T::decision.get(process)))
      }
    ).size()

  def maxRoundReached =
    T::Corr.fold(0, (best, process) =>
      if (best < T::round.get(process)) T::round.get(process) else best
    )

  def stalledAtMaxRound = T::Corr.forall(process => T::round.get(process) == T::MaxRound)

  def outcome =
    if (not(T::Agreement)) {
      "forked"
    } else if (decidedCount == T::Corr.size()) {
      "decided"
    } else if (stalledAtMaxRound) {
      "max_round_without_decision"
    } else {
      "timeout"
    }

  def finished =
    decidedCount == T::Corr.size() or stalledAtMaxRound or ticks == REPORT_LIMIT

  action init = all {
    T::Init,
    ticks' = 0,
    reported' = false,
  }

  action protocolStep = all {
    decidedCount < T::Corr.size(),
    not(stalledAtMaxRound),
    ticks < REPORT_LIMIT,
    T::Next,
    ticks' = ticks + 1,
    reported' = reported,
  }

  action report = all {
    finished,
    not(reported),
    q::tap("tendermint.outcome", outcome) == outcome,
    q::tap("tendermint.report_steps", ticks) == ticks,
    q::tap("tendermint.decided_processes", decidedCount) == decidedCount,
    q::tap("tendermint.distinct_decisions", distinctDecisionCount) == distinctDecisionCount,
    q::tap("tendermint.max_round_reached", maxRoundReached) == maxRoundReached,
    q::tap("tendermint.proposal_evidence", T::evidencePropose.size()) == T::evidencePropose.size(),
    q::tap("tendermint.prevote_evidence", T::evidencePrevote.size()) == T::evidencePrevote.size(),
    q::tap("tendermint.precommit_evidence", T::evidencePrecommit.size()) == T::evidencePrecommit.size(),
    q::tap("tendermint.equivocating_faulty_processes", T::Faulty.filter(p => T::EquivocationBy(p)).size()) ==
      T::Faulty.filter(p => T::EquivocationBy(p)).size(),
    q::tap("tendermint.amnesiac_faulty_processes", T::Faulty.filter(p => T::AmnesiaBy(p)).size()) ==
      T::Faulty.filter(p => T::AmnesiaBy(p)).size(),
    q::tap("tendermint.last_action", T::fired_action) == T::fired_action,
    q::tap("tendermint.accountability_holds", T::Accountability) == T::Accountability,
    q::tap("tendermint.profile", "canonical_baseline") == "canonical_baseline",
    T::round' = T::round,
    T::step' = T::step,
    T::decision' = T::decision,
    T::lockedValue' = T::lockedValue,
    T::lockedRound' = T::lockedRound,
    T::validValue' = T::validValue,
    T::validRound' = T::validRound,
    T::msgsPropose' = T::msgsPropose,
    T::msgsPrevote' = T::msgsPrevote,
    T::msgsPrecommit' = T::msgsPrecommit,
    T::evidencePropose' = T::evidencePropose,
    T::evidencePrevote' = T::evidencePrevote,
    T::evidencePrecommit' = T::evidencePrecommit,
    T::fired_action' = T::fired_action,
    ticks' = ticks,
    reported' = true,
  }

  action step = any {
    protocolStep,
    report,
  }

  val accountabilityInv = T::Accountability and T::Validity
}
