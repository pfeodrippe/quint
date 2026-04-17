module twoPhaseCommitLiveDebug {
  pure val RM_SET = Set("rm1", "rm2", "rm3")

  import two_phase_commit(resourceManagers = RM_SET) as T from "../../classic/distributed/TwoPhaseCommit/two_phase_commit"
  import raylibDemo.* from "./raylib"

  var tick: int
  var prepareCount: int
  var commitCount: int
  var abortCount: int
  var lastKind: str
  var lastRm: str

  def countRMs(state) = RM_SET.filter(rm => T::RM::states.get(rm) == state).size()

  action init = all {
    T::init,
    tick' = 0,
    prepareCount' = 0,
    commitCount' = 0,
    abortCount' = 0,
    lastKind' = "init",
    lastRm' = "rm1",
  }

  action rmPrepare(rm: str): bool = all {
    T::RM::prepare(rm),
    T::TM::state' = T::TM::state,
    T::TM::preparedRMs' = T::TM::preparedRMs,
    tick' = tick + 1,
    prepareCount' = prepareCount + 1,
    commitCount' = commitCount,
    abortCount' = abortCount,
    lastKind' = "prepare",
    lastRm' = rm,
  }

  action rmAbort(rm: str): bool = all {
    T::RM::abort(rm),
    T::TM::state' = T::TM::state,
    T::TM::preparedRMs' = T::TM::preparedRMs,
    tick' = tick + 1,
    prepareCount' = prepareCount,
    commitCount' = commitCount,
    abortCount' = abortCount + 1,
    lastKind' = "rm-abort",
    lastRm' = rm,
  }

  action rmCommit(rm: str): bool = all {
    T::RM::commit(rm),
    T::TM::state' = T::TM::state,
    T::TM::preparedRMs' = T::TM::preparedRMs,
    tick' = tick + 1,
    prepareCount' = prepareCount,
    commitCount' = commitCount + 1,
    abortCount' = abortCount,
    lastKind' = "rm-commit",
    lastRm' = rm,
  }

  action tmCommitDecision = all {
    T::TM::decideOnCommit,
    T::TM::preparedRMs' = T::TM::preparedRMs,
    T::RM::states' = T::RM::states,
    tick' = tick + 1,
    prepareCount' = prepareCount,
    commitCount' = commitCount + 1,
    abortCount' = abortCount,
    lastKind' = "tm-commit",
    lastRm' = "tm",
  }

  action tmAbortDecision = all {
    T::TM::decideOnAbort,
    T::TM::preparedRMs' = T::TM::preparedRMs,
    T::RM::states' = T::RM::states,
    tick' = tick + 1,
    prepareCount' = prepareCount,
    commitCount' = commitCount,
    abortCount' = abortCount + 1,
    lastKind' = "tm-abort",
    lastRm' = "tm",
  }

  action tmConsumesPrepared(rm: str): bool = all {
    T::TM::addPreparedResourceManager(rm),
    T::TM::state' = T::TM::state,
    T::RM::states' = T::RM::states,
    T::messages' = T::messages,
    tick' = tick + 1,
    prepareCount' = prepareCount,
    commitCount' = commitCount,
    abortCount' = abortCount,
    lastKind' = "tm-ack-prepare",
    lastRm' = rm,
  }

  action protocolStep = any {
    all {
      nondet rm = RM_SET.oneOf()
      any { rmPrepare(rm), rmAbort(rm), rmCommit(rm), tmConsumesPrepared(rm) },
    },
    tmCommitDecision,
    tmAbortDecision,
  }

  def drawResourceManager(rm: str, left: int): bool = all {
    rlDrawText(rm, left, 206, 24, 255, 255, 255) == 0,
    if (T::RM::states.get(rm) == T::Working)
      rlDrawRect(left, 244, 120, 70, 0, 121, 241) == 0
    else if (T::RM::states.get(rm) == T::Prepared)
      rlDrawRect(left, 244, 120, 70, 253, 249, 0) == 0
    else if (T::RM::states.get(rm) == T::Committed)
      rlDrawRect(left, 244, 120, 70, 0, 228, 48) == 0
    else
      rlDrawRect(left, 244, 120, 70, 230, 41, 55) == 0,
    if (lastRm == rm) rlDrawCircle(left + 104, 218, 8, 255, 161, 0) == 0 else true,
    if (T::TM::preparedRMs.contains(rm)) rlDrawCircle(left + 20, 338, 8, 253, 249, 0) == 0 else true,
    if (T::messages.contains(T::RMPrepared(rm))) rlDrawCircle(left + 52, 338, 8, 255, 161, 0) == 0 else true,
    rlDrawText("tm prepared", left, 354, 16, 220, 220, 220) == 0,
    rlDrawText("msg sent", left, 374, 16, 220, 220, 220) == 0,
  }

  action keepState = all {
    T::RM::states' = T::RM::states,
    T::TM::state' = T::TM::state,
    T::TM::preparedRMs' = T::TM::preparedRMs,
    T::messages' = T::messages,
    tick' = tick,
    prepareCount' = prepareCount,
    commitCount' = commitCount,
    abortCount' = abortCount,
    lastKind' = lastKind,
    lastRm' = lastRm,
  }

  action renderFrame = all {
    keepState,
    rlClearScene == 0,
    rlSetCounter(tick) == 0,
    rlDrawText("Two-Phase Commit live debugger", 20, 60, 28, 255, 255, 255) == 0,
    rlDrawText("real repo spec, normal quint run", 20, 92, 18, 200, 200, 200) == 0,
    if (T::consistencyInv)
      rlDrawText("consistency invariant: OK", 520, 60, 20, 0, 228, 48) == 0
    else
      rlDrawText("consistency invariant: BROKEN", 520, 60, 20, 230, 41, 55) == 0,
    rlDrawText("TM state", 20, 130, 20, 220, 220, 220) == 0,
    if (T::TM::state == T::Init)
      rlDrawText("Init", 120, 130, 20, 0, 121, 241) == 0
    else if (T::TM::state == T::TMCommitted)
      rlDrawText("Committed", 120, 130, 20, 0, 228, 48) == 0
    else
      rlDrawText("Aborted", 120, 130, 20, 230, 41, 55) == 0,
    rlDrawText("last action", 20, 158, 20, 220, 220, 220) == 0,
    rlDrawText(lastKind, 120, 158, 20, 255, 255, 255) == 0,
    rlDrawText("last actor", 20, 186, 20, 220, 220, 220) == 0,
    rlDrawText(lastRm, 120, 186, 20, 255, 255, 255) == 0,
    rlDrawTextInt("prepare steps ", prepareCount, 280, 130, 20, 253, 249, 0) == 0,
    rlDrawTextInt("commit steps ", commitCount, 280, 156, 20, 0, 228, 48) == 0,
    rlDrawTextInt("abort steps ", abortCount, 280, 182, 20, 230, 41, 55) == 0,
    rlDrawTextInt("messages ", T::messages.size(), 520, 92, 18, 255, 255, 255) == 0,
    rlDrawTextInt("prepared RMs ", T::TM::preparedRMs.size(), 520, 116, 18, 255, 255, 255) == 0,
    rlDrawTextInt("working ", countRMs(T::Working), 520, 156, 18, 0, 121, 241) == 0,
    rlDrawTextInt("prepared ", countRMs(T::Prepared), 520, 180, 18, 253, 249, 0) == 0,
    rlDrawTextInt("committed ", countRMs(T::Committed), 520, 204, 18, 0, 228, 48) == 0,
    rlDrawTextInt("aborted ", countRMs(T::Aborted), 520, 228, 18, 230, 41, 55) == 0,
    if (T::messages.contains(T::Commit))
      rlDrawText("commit message present", 20, 416, 18, 0, 228, 48) == 0
    else
      rlDrawText("commit message absent", 20, 416, 18, 120, 120, 120) == 0,
    if (T::messages.contains(T::Abort))
      rlDrawText("abort message present", 260, 416, 18, 230, 41, 55) == 0
    else
      rlDrawText("abort message absent", 260, 416, 18, 120, 120, 120) == 0,
    drawResourceManager("rm1", 40),
    drawResourceManager("rm2", 260),
    drawResourceManager("rm3", 480),
  }

  action waitFrame = all {
    keepState,
    rlSleepMillis(50) == 0,
  }

  action liveInit = init.then(renderFrame).then(waitFrame)
  action liveStep = protocolStep.then(renderFrame).then(waitFrame)
}
