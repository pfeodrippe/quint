// Tests that demonstrate typical behavior.
module TendermintImprovedTest {
  import TendermintImproved.* from "./TendermintImproved"
  export TendermintImproved.*

  // Quint will automatically compute the unchanged block in the future
  action unchangedAll = all {
    step' = step,
    fired_action' = fired_action,
    round' = round,
    validValue' = validValue,
    validRound' = validRound,
    msgsPrevote' = msgsPrevote,
    msgsPropose' = msgsPropose,
    msgsPrecommit' = msgsPrecommit,
    decision' = decision,
    lockedValue' = lockedValue,
    lockedRound' = lockedRound,
    evidencePropose' = evidencePropose,
    evidencePrevote' = evidencePrevote,
    evidencePrecommit' = evidencePrecommit,
    proposeTimeoutElapsed' = proposeTimeoutElapsed,
  }

  action broadcastPrevoteFull(src, r, id) = all {
    BroadcastPrevote(src, r, id),
    step' = step,
    fired_action' = fired_action,
    round' = round,
    validValue' = validValue,
    validRound' = validRound,
    msgsPropose' = msgsPropose,
    msgsPrecommit' = msgsPrecommit,
    decision' = decision,
    lockedValue' = lockedValue,
    lockedRound' = lockedRound,
    evidencePropose' = evidencePropose,
    evidencePrevote' = evidencePrevote,
    evidencePrecommit' = evidencePrecommit,
    proposeTimeoutElapsed' = proposeTimeoutElapsed,
  }

  action startRoundFull(p, r) = all {
    StartRound(p, r),
    fired_action' = fired_action,
    validValue' = validValue,
    validRound' = validRound,
    msgsPrevote' = msgsPrevote,
    msgsPropose' = msgsPropose,
    msgsPrecommit' = msgsPrecommit,
    decision' = decision,
    lockedValue' = lockedValue,
    lockedRound' = lockedRound,
    evidencePropose' = evidencePropose,
    evidencePrevote' = evidencePrevote,
    evidencePrecommit' = evidencePrecommit,
  }

  // three correct processes behave and decide on the same value
  run decisionTest = {
    if (size(Corr) >= 3) {
      nondet v = oneOf(ValidValues)
      val p1 = Proposer.get(0)
      nondet p2 = Corr.exclude(Set(p1)).oneOf()
      nondet p3 = Corr.exclude(Set(p1, p2)).oneOf()
      Init.then(InsertProposal(p1, v))
          .then(UponProposalInPropose(p1, v))
          .then(UponProposalInPropose(p2, v))
          .then(UponProposalInPropose(p3, v))
          .then(UponProposalInPrevoteOrCommitAndPrevote(p1, v, NilRound))
          .then(UponProposalInPrevoteOrCommitAndPrevote(p2, v, NilRound))
          .then(UponProposalInPrevoteOrCommitAndPrevote(p3, v, NilRound))
          .then(UponProposalInPrecommitNoDecision(p1, v, 0, NilRound))
          .then(UponProposalInPrecommitNoDecision(p2, v, 0, NilRound))
          .then(UponProposalInPrecommitNoDecision(p3, v, 0, NilRound))
          .then(all {
            assert(decision.get(p1) == v),
            assert(decision.get(p2) == v),
            assert(decision.get(p3) == v),
            unchangedAll,
          })
    } else {
      Init.then(unchangedAll)
    }
  }

  // a correct proposer cannot propose twice in the same round
  run noProposeTwiceTest = {
    val p1 = Proposer.get(0)
    Init.then(InsertProposal(p1, "v0"))
        .then(InsertProposal(p1, "v1"))
        .fail()
  }

  // a known proposal + polka should not fall back to the generic any-prevote branch
  run knownProposalPolkaSkipsAnyPrevoteTest = {
    if (size(Corr) >= 3) {
      nondet v = oneOf(ValidValues)
      val p1 = Proposer.get(0)
      nondet p2 = Corr.exclude(Set(p1)).oneOf()
      nondet p3 = Corr.exclude(Set(p1, p2)).oneOf()
      Init.then(InsertProposal(p1, v))
          .then(UponProposalInPropose(p1, v))
          .then(UponProposalInPropose(p2, v))
          .then(UponProposalInPropose(p3, v))
          .then(
            val E = msgsPrevote.get(0).filter(m => m.src.in(Corr))
            UponQuorumOfPrevotesAny(p1, E)
          )
          .fail()
    } else {
      Init.then(unchangedAll)
    }
  }

  // if a current-round polka already exists when a process handles the proposal, it should go straight to precommit
  run currentRoundPolkaInProposeSkipsPrevoteStepTest = {
    if (size(Corr) >= 3 and size(Faulty) >= 1) {
      nondet v = oneOf(ValidValues)
      val p1 = Proposer.get(0)
      nondet p2 = Corr.exclude(Set(p1)).oneOf()
      nondet p3 = Corr.exclude(Set(p1, p2)).oneOf()
      nondet p4 = Faulty.oneOf()
      Init.then(InsertProposal(p1, v))
          .then(broadcastPrevoteFull(p4, 0, Id(v)))
          .then(UponProposalInPropose(p2, v))
          .then(UponProposalInPropose(p3, v))
          .then(UponProposalInPropose(p1, v))
          .then(all {
            assert(step.get(p1) == "precommit"),
            assert(msgsPrevote.get(0).contains({ src: p1, round: 0, id: Id(v) })),
            assert(msgsPrecommit.get(0).contains({ src: p1, round: 0, id: Id(v) })),
            assert(lockedValue.get(p1) == v),
            assert(lockedRound.get(p1) == 0),
            assert(validValue.get(p1) == v),
            assert(validRound.get(p1) == 0),
            unchangedAll,
          })
    } else {
      Init.then(unchangedAll)
    }
  }

  // catching up into a round that already has the proposal and a proposal-backed polka should go straight to precommit
  run roundCatchupWithProposalPolkaSkipsProposeStepTest = {
    if (size(Corr) >= 3 and size(Faulty) >= 1) {
      nondet v = oneOf(ValidValues)
      val p1 = Proposer.get(0)
      val p2 = Proposer.get(1)
      nondet p3 = Corr.exclude(Set(p1, p2)).oneOf()
      nondet p4 = Faulty.oneOf()
      Init.then(startRoundFull(p2, 1))
          .then(InsertProposal(p2, v))
          .then(broadcastPrevoteFull(p2, 1, Id(v)))
          .then(broadcastPrevoteFull(p3, 1, Id(v)))
          .then(broadcastPrevoteFull(p4, 1, Id(v)))
          .then(OnRoundCatchupWithProposalPolka(p1))
          .then(all {
            assert(round.get(p1) == 1),
            assert(step.get(p1) == "precommit"),
            assert(msgsPrevote.get(1).contains({ src: p1, round: 1, id: Id(v) })),
            assert(msgsPrecommit.get(1).contains({ src: p1, round: 1, id: Id(v) })),
            assert(lockedValue.get(p1) == v),
            assert(lockedRound.get(p1) == 1),
            assert(validValue.get(p1) == v),
            assert(validRound.get(p1) == 1),
            unchangedAll,
          })
    } else {
      Init.then(unchangedAll)
    }
  }

  // a known proposal + commit quorum should not fall back to the generic any-precommit branch
  run knownProposalCommitSkipsAnyPrecommitTest = {
    if (size(Corr) >= 3) {
      nondet v = oneOf(ValidValues)
      val p1 = Proposer.get(0)
      nondet p2 = Corr.exclude(Set(p1)).oneOf()
      nondet p3 = Corr.exclude(Set(p1, p2)).oneOf()
      Init.then(InsertProposal(p1, v))
          .then(UponProposalInPropose(p1, v))
          .then(UponProposalInPropose(p2, v))
          .then(UponProposalInPropose(p3, v))
          .then(UponProposalInPrevoteOrCommitAndPrevote(p1, v, NilRound))
          .then(UponProposalInPrevoteOrCommitAndPrevote(p2, v, NilRound))
          .then(UponProposalInPrevoteOrCommitAndPrevote(p3, v, NilRound))
          .then(
            val E = msgsPrecommit.get(0).filter(m => m.src.in(Corr))
            UponQuorumOfPrecommitsAny(p1, E)
          )
          .fail()
    } else {
      Init.then(unchangedAll)
    }
  }

  // a non-proposer can timeout only after the explicit timeout-expiration step
  run timeoutProposeTest = {
    if (size(Corr) >= 3) {
      val p1 = Proposer.get(0)
      nondet p2 = Corr.exclude(Set(p1)).oneOf()
      Init
          .then(ExpireTimeoutPropose(p2))
          .then(OnTimeoutPropose(p2))
          .then(all {
            assert(step.get(p2) == "prevote"),
            assert(msgsPrevote.get(0).contains({ src: p2, round: 0, id: NilValue })),
            unchangedAll,
          })
    } else {
      Init.then(unchangedAll)
    }
  }
}
