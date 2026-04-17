module paxosStats {
  pure val MAX_BALLOT = 4
  pure val REPORT_LIMIT = 24
  pure val BALLOTS = 0.to(MAX_BALLOT)

  import Paxos(
    Value = Set(0, 1),
    Acceptor = Set("a1", "a2", "a3"),
    Quorum = Set(Set("a1", "a2"))
  ) as T from "../classic/distributed/Paxos/Paxos"

  var ticks: int
  var reported: bool
  var maxMessagesSeen: int
  var maxVotesSeen: int
  var maxPromisedBallotSeen: int

  pure def isMsg1a(message) = match message {
    | Msg1a(_) => true
    | _ => false
  }

  pure def isMsg1b(message) = match message {
    | Msg1b(_) => true
    | _ => false
  }

  pure def isMsg2a(message) = match message {
    | Msg2a(_) => true
    | _ => false
  }

  pure def isMsg2b(message) = match message {
    | Msg2b(_) => true
    | _ => false
  }

  def totalVotes =
    T::Acceptor.fold(0, (sum, acceptor) => sum + T::votes.get(acceptor).size())

  def maxPromisedBallot =
    T::Acceptor.fold(0, (best, acceptor) =>
      if (best < T::maxBal.get(acceptor)) T::maxBal.get(acceptor) else best
    )

  def allVotes =
    T::Acceptor.fold(Set(), (acc, acceptor) => acc.union(T::votes.get(acceptor)))

  def chosenVotePairs =
    allVotes.filter(vote =>
      T::Quorum.exists(quorum => quorum.forall(acceptor => T::votes.get(acceptor).contains(vote)))
    )

  def chosenValues = chosenVotePairs.map(vote => vote._2)

  def chosenValue =
    if (chosenValues.size() == 0) {
      "none"
    } else if (chosenValues.contains(0)) {
      "0"
    } else {
      "1"
    }

  def finished = chosenValues.size() > 0 or ticks == REPORT_LIMIT

  action init = all {
    T::Init,
    ticks' = 0,
    reported' = false,
    maxMessagesSeen' = 0,
    maxVotesSeen' = 0,
    maxPromisedBallotSeen' = 0,
  }

  action boundedPaxosStep = any {
    all {
      nondet b = BALLOTS.oneOf()
      any {
        T::Phase1a(b),
        all {
          nondet v = T::Value.oneOf()
          T::Phase2a(b, v)
        },
      },
      T::maxBal' = T::maxBal,
    },
    nondet a = T::Acceptor.oneOf()
    any {
      T::Phase1b(a),
      T::Phase2b(a),
    },
  }

  action protocolStep = all {
    chosenValues.size() == 0,
    ticks < REPORT_LIMIT,
    boundedPaxosStep,
    ticks' = ticks + 1,
    reported' = reported,
    maxMessagesSeen' = if (maxMessagesSeen < T::msgs.size()) T::msgs.size() else maxMessagesSeen,
    maxVotesSeen' = if (maxVotesSeen < totalVotes) totalVotes else maxVotesSeen,
    maxPromisedBallotSeen' =
      if (maxPromisedBallotSeen < maxPromisedBallot) maxPromisedBallot else maxPromisedBallotSeen,
  }

  action report = all {
    finished,
    not(reported),
    q::tap("paxos.outcome", if (chosenValues.size() > 0) "chosen" else "timeout") ==
      if (chosenValues.size() > 0) "chosen" else "timeout",
    q::tap("paxos.chosen_value", chosenValue) == chosenValue,
    q::tap("paxos.report_steps", ticks) == ticks,
    q::tap("paxos.total_messages", T::msgs.size()) == T::msgs.size(),
    q::tap("paxos.phase1a_messages", T::msgs.filter(message => isMsg1a(message)).size()) ==
      T::msgs.filter(message => isMsg1a(message)).size(),
    q::tap("paxos.phase1b_messages", T::msgs.filter(message => isMsg1b(message)).size()) ==
      T::msgs.filter(message => isMsg1b(message)).size(),
    q::tap("paxos.phase2a_messages", T::msgs.filter(message => isMsg2a(message)).size()) ==
      T::msgs.filter(message => isMsg2a(message)).size(),
    q::tap("paxos.phase2b_messages", T::msgs.filter(message => isMsg2b(message)).size()) ==
      T::msgs.filter(message => isMsg2b(message)).size(),
    q::tap("paxos.total_votes", totalVotes) == totalVotes,
    q::tap("paxos.max_promised_ballot", maxPromisedBallot) == maxPromisedBallot,
    q::tap("paxos.max_messages_seen", maxMessagesSeen) == maxMessagesSeen,
    q::tap("paxos.max_votes_seen", maxVotesSeen) == maxVotesSeen,
    q::tap("paxos.max_promised_ballot_seen", maxPromisedBallotSeen) == maxPromisedBallotSeen,
    T::maxBal' = T::maxBal,
    T::maxVBal' = T::maxVBal,
    T::maxVal' = T::maxVal,
    T::msgs' = T::msgs,
    ticks' = ticks,
    reported' = true,
    maxMessagesSeen' = maxMessagesSeen,
    maxVotesSeen' = maxVotesSeen,
    maxPromisedBallotSeen' = maxPromisedBallotSeen,
  }

  action step = any {
    protocolStep,
    report,
  }

  val inv = and {
    T::Acceptor.forall(acceptor =>
      and {
        T::maxBal.get(acceptor) >= -1,
        T::votes.get(acceptor).forall(vote => and {
          vote._1 >= 0,
          T::Value.contains(vote._2),
        }),
      }
    ),
    T::Acceptor.forall(left =>
      T::Acceptor.forall(right =>
        T::votes.get(left).forall(leftVote =>
          T::votes.get(right).forall(rightVote =>
            leftVote._1 == rightVote._1 implies leftVote._2 == rightVote._2
          )
        )
      )
    ),
    chosenValues.size() <= 1,
  }
}
