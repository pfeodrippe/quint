module lightclientStats {
  import LCVerificationApi(
    TRUSTING_PERIOD = 12,
    CLOCK_DRIFT = 1,
    REAL_CLOCK_DRIFT = 1,
    FAULTY_RATIO = (1, 3)
  ) as API from "../cosmos/lightclient/LCVerificationApi"

  pure val REPORT_LIMIT = 8
  pure val TRUSTED_HEIGHT = 1
  pure val TARGET_HEIGHT = 3
  pure val ULTIMATE_HEIGHT = 4
  pure val INITIAL_REF_CLOCK = 10
  pure val INITIAL_LOCAL_CLOCK = 10
  pure val HEIGHTS = TRUSTED_HEIGHT.to(TARGET_HEIGHT)
  pure val CLOCK_VALUES = 0.to(16)
  pure val ALL_NODES = Set("n1", "n2", "n3", "n4")
  pure val VERIFIED = "StateVerified"
  pure val UNVERIFIED = "StateUnverified"
  pure val FAILED = "StateFailed"

  pure val header1 = {
    height: 1,
    time: 1,
    lastCommit: Set(),
    VS: ALL_NODES,
    NextVS: Set("n1", "n2", "n3"),
  }

  pure val header2 = {
    height: 2,
    time: 4,
    lastCommit: Set("n1", "n2", "n3"),
    VS: Set("n1", "n2", "n3"),
    NextVS: Set("n3", "n4"),
  }

  pure val header3 = {
    height: 3,
    time: 7,
    lastCommit: Set("n1", "n2", "n3"),
    VS: Set("n3", "n4"),
    NextVS: Set("n3", "n4"),
  }

  pure val header4 = {
    height: 4,
    time: 10,
    lastCommit: Set("n3", "n4"),
    VS: Set("n3", "n4"),
    NextVS: ALL_NODES,
  }

  pure val blockchain = Map(
    1 -> header1,
    2 -> header2,
    3 -> header3,
    4 -> header4
  )

  pure def trustedLightBlock = { header: header1, Commits: ALL_NODES }

  pure def correctLightBlock(height) =
    if (height == 1) {
      trustedLightBlock
    } else if (height == 2) {
      { header: header2, Commits: header3.lastCommit }
    } else if (height == 3) {
      { header: header3, Commits: header4.lastCommit }
    } else {
      { header: header4, Commits: header4.VS }
    }

  pure def invalidLightBlock(height) =
    if (height == 2) {
      { header: header2, Commits: Set("n1") }
    } else if (height == 3) {
      { header: header3, Commits: Set("n3") }
    } else {
      correctLightBlock(height)
    }

  pure def fetchChoices(height) =
    if (height == 2) {
      Set(correctLightBlock(2), invalidLightBlock(2))
    } else if (height == 3) {
      Set(correctLightBlock(3), invalidLightBlock(3))
    } else {
      Set(correctLightBlock(height))
    }

  pure def lightStoreUpdateBlocks(lightBlocks, block) = lightBlocks.put(block.header.height, block)

  pure def lightStoreUpdateStates(statuses, ht, blockState) = statuses.put(ht, blockState)

  pure def canScheduleTo(newHeight, latestVerifiedHeight, currentNextHeight) = or {
    and {
      latestVerifiedHeight == currentNextHeight,
      currentNextHeight < newHeight,
      newHeight <= TARGET_HEIGHT,
    },
    and {
      latestVerifiedHeight < currentNextHeight,
      latestVerifiedHeight < TARGET_HEIGHT,
      latestVerifiedHeight < newHeight,
      newHeight < currentNextHeight,
    },
    and {
      latestVerifiedHeight == TARGET_HEIGHT,
      newHeight == TARGET_HEIGHT,
    },
  }

  var state: str
  var nextHeight: int
  var nprobes: int
  var fetchedLightBlocks: int -> { header: { height: int, time: int, lastCommit: Set[str], VS: Set[str], NextVS: Set[str] }, Commits: Set[str] }
  var lightBlockStatus: int -> str
  var latestVerified: { header: { height: int, time: int, lastCommit: Set[str], VS: Set[str], NextVS: Set[str] }, Commits: Set[str] }
  var prevVerified: { header: { height: int, time: int, lastCommit: Set[str], VS: Set[str], NextVS: Set[str] }, Commits: Set[str] }
  var prevCurrent: { header: { height: int, time: int, lastCommit: Set[str], VS: Set[str], NextVS: Set[str] }, Commits: Set[str] }
  var prevVerdict: str
  var refClock: int
  var ticks: int
  var reported: bool

  def trustedHeaderStillValid = API::InTrustingPeriodLocal(header1)

  def verifiedCount =
    fetchedLightBlocks.keys().filter(height => lightBlockStatus.get(height) == VERIFIED).size()

  def unverifiedCount =
    fetchedLightBlocks.keys().filter(height => lightBlockStatus.get(height) == UNVERIFIED).size()

  def failedCount =
    fetchedLightBlocks.keys().filter(height => lightBlockStatus.get(height) == FAILED).size()

  def finished = state != "working" or ticks == REPORT_LIMIT

  def outcome =
    if (state == "finishedSuccess") {
      "success"
    } else if (state == "finishedFailure") {
      prevVerdict
    } else {
      "timeout"
    }

  action init = all {
    state' = "working",
    nextHeight' = TARGET_HEIGHT,
    nprobes' = 0,
    fetchedLightBlocks' = Map(TRUSTED_HEIGHT -> trustedLightBlock),
    lightBlockStatus' = Map(TRUSTED_HEIGHT -> VERIFIED),
    latestVerified' = trustedLightBlock,
    prevVerified' = trustedLightBlock,
    prevCurrent' = trustedLightBlock,
    prevVerdict' = "SUCCESS",
    refClock' = INITIAL_REF_CLOCK,
    API::localClock' = INITIAL_LOCAL_CLOCK,
    ticks' = 0,
    reported' = false,
  }

  action protocolStep = all {
    state == "working",
    ticks < REPORT_LIMIT,
    nondet current = fetchChoices(nextHeight).oneOf()
    all {
      if (nextHeight.in(fetchedLightBlocks.keys())) {
        all {
          current == fetchedLightBlocks.get(nextHeight),
          fetchedLightBlocks' = fetchedLightBlocks,
        }
      } else {
        fetchedLightBlocks' = lightStoreUpdateBlocks(fetchedLightBlocks, current)
      },
      prevVerified' = latestVerified,
      prevCurrent' = current,
      nondet newRefClock = CLOCK_VALUES.oneOf()
      all {
        nondet newLocalClock = CLOCK_VALUES.oneOf()
        all {
          nprobes' = nprobes + 1,
          ticks' = ticks + 1,
          reported' = reported,
          newRefClock >= refClock,
          API::IsLocalClockWithinDrift(newLocalClock, newRefClock),
          q::tap("lightclient.requested_height_each_step", nextHeight) == nextHeight,
          q::tap("lightclient.current_height_each_step", current.header.height) == current.header.height,
          q::tap("lightclient.trusted_header_valid_each_step", trustedHeaderStillValid) == trustedHeaderStillValid,
          refClock' = newRefClock,
          API::localClock' = newLocalClock,
          val verdict = API::ValidAndVerified(latestVerified, current, true)
          all {
            val tappedVerdict = q::tap("lightclient.verdict_each_step", verdict)
            all {
              prevVerdict' = tappedVerdict,
              if (tappedVerdict == "SUCCESS") {
                all {
                  lightBlockStatus' = lightStoreUpdateStates(lightBlockStatus, nextHeight, VERIFIED),
                  latestVerified' = current,
                  state' = if (current.header.height < TARGET_HEIGHT) "working" else "finishedSuccess",
                  if (current.header.height < TARGET_HEIGHT) {
                    nondet newHeight = HEIGHTS.oneOf()
                    all {
                      canScheduleTo(newHeight, current.header.height, nextHeight),
                      nextHeight' = newHeight,
                    }
                  } else {
                    nextHeight' = TARGET_HEIGHT
                  },
                }
              } else if (tappedVerdict == "NOT_ENOUGH_TRUST") {
                all {
                  lightBlockStatus' = lightStoreUpdateStates(lightBlockStatus, nextHeight, UNVERIFIED),
                  latestVerified' = latestVerified,
                  state' = state,
                  nondet newHeight = HEIGHTS.oneOf()
                  all {
                    canScheduleTo(newHeight, latestVerified.header.height, nextHeight),
                    nextHeight' = newHeight,
                  },
                }
              } else {
                all {
                  lightBlockStatus' = lightStoreUpdateStates(lightBlockStatus, nextHeight, FAILED),
                  latestVerified' = latestVerified,
                  state' = "finishedFailure",
                  nextHeight' = nextHeight,
                }
              },
            }
          }
        }
      }
    },
  }

  action report = all {
    finished,
    not(reported),
    q::tap("lightclient.outcome", outcome) == outcome,
    q::tap("lightclient.report_steps", ticks) == ticks,
    q::tap("lightclient.nprobes", nprobes) == nprobes,
    q::tap("lightclient.verified_blocks", verifiedCount) == verifiedCount,
    q::tap("lightclient.unverified_blocks", unverifiedCount) == unverifiedCount,
    q::tap("lightclient.failed_blocks", failedCount) == failedCount,
    q::tap("lightclient.latest_verified_height", latestVerified.header.height) == latestVerified.header.height,
    q::tap("lightclient.next_height", nextHeight) == nextHeight,
    q::tap("lightclient.last_verdict", prevVerdict) == prevVerdict,
    q::tap("lightclient.local_clock", API::localClock) == API::localClock,
    q::tap("lightclient.ref_clock", refClock) == refClock,
    q::tap("lightclient.trusted_header_still_valid", trustedHeaderStillValid) == trustedHeaderStillValid,
    state' = state,
    nextHeight' = nextHeight,
    nprobes' = nprobes,
    fetchedLightBlocks' = fetchedLightBlocks,
    lightBlockStatus' = lightBlockStatus,
    latestVerified' = latestVerified,
    prevVerified' = prevVerified,
    prevCurrent' = prevCurrent,
    prevVerdict' = prevVerdict,
    refClock' = refClock,
    API::localClock' = API::localClock,
    ticks' = ticks,
    reported' = true,
  }

  action step = any {
    protocolStep,
    report,
  }

  val inv = and {
    Set("working", "finishedSuccess", "finishedFailure").contains(state),
    HEIGHTS.contains(nextHeight),
    ticks >= 0,
    ticks <= REPORT_LIMIT,
    nprobes == ticks,
    API::IsLocalClockWithinDrift(API::localClock, refClock),
    fetchedLightBlocks.keys().subseteq(HEIGHTS),
    fetchedLightBlocks.keys().contains(TRUSTED_HEIGHT),
    lightBlockStatus.get(TRUSTED_HEIGHT) == VERIFIED,
    fetchedLightBlocks.keys().contains(latestVerified.header.height),
    lightBlockStatus.get(latestVerified.header.height) == VERIFIED,
    fetchedLightBlocks.keys().forall(height =>
      Set(VERIFIED, UNVERIFIED, FAILED).contains(lightBlockStatus.get(height))
    ),
    fetchedLightBlocks.keys().forall(height =>
      lightBlockStatus.get(height) == VERIFIED implies fetchedLightBlocks.get(height).header == blockchain.get(height)
    ),
  }
}
