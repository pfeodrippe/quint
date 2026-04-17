module bankLiveDebug {
  import bank.* from "../../cosmos/bank/bank"
  import raylibDemo.* from "./raylib"

  var supply: Denom -> Int256
  var balances: Addr -> Coins
  var _lastError: str
  var tick: int
  var successes: int
  var failures: int
  var lastAmount: int
  var lastFrom: Addr
  var lastTo: Addr
  var lastDenom: Denom
  var lastWasSuccess: bool

  pure val ADDR = Set("king", "donkeykong", "peaches", "mario")
  pure val DENOM = Set("banana", "burger")
  pure val MAX_AMOUNT = 10_000
  pure val BAR_SCALE = 80

  def stateToCtx(time: int): BankCtx = {
    {
      blockTime: time,
      accounts: balances.keys(),
      balances: balances,
      params: {
        sendEnabled: Set(),
        defaultSendEnabled: true
      }
    }
  }

  pure def getOr0(coins: Coins, denom: Denom): int = if (denom.in(coins.keys())) coins.get(denom) else 0

  def balanceOf(addr: Addr, denom: Denom): int = {
    if (addr.in(balances.keys())) getOr0(balances.get(addr), denom) else 0
  }

  pure def barHeight(amount: int): int = {
    val scaled = amount / BAR_SCALE
    if (scaled < 0) 0 else if (scaled > 140) 140 else scaled
  }

  def sumForDenom(denom: Denom): Int256 = {
    balances.keys().fold(0, (sum, addr) => {
      val coins = balances.get(addr)
      if (denom.in(coins.keys())) {
        sum + coins.get(denom)
      } else {
        sum
      }
    })
  }

  val totalSupplyInv = {
    supply.keys().forall(denom => sumForDenom(denom) == supply.get(denom))
  }

  action init = all {
    supply' = DENOM.mapBy(d => MAX_AMOUNT),
    balances' = Map("king" -> DENOM.mapBy(d => MAX_AMOUNT)),
    _lastError' = "",
    tick' = 0,
    successes' = 0,
    failures' = 0,
    lastAmount' = 0,
    lastFrom' = "king",
    lastTo' = "king",
    lastDenom' = "banana",
    lastWasSuccess' = true,
  }

  action sendTracked(fromAddr: Addr, toAddr: Addr, denom: Denom, amount: Int256): bool = all {
    val ctx = stateToCtx(tick)
    val result = SendKeeper::SendCoins(ctx, fromAddr, toAddr, Map(denom -> amount))
    match result {
      | BankOk(newCtx) => all {
        balances' = newCtx.balances,
        supply' = supply,
        _lastError' = "",
        tick' = tick + 1,
        successes' = successes + 1,
        failures' = failures,
        lastAmount' = amount,
        lastFrom' = fromAddr,
        lastTo' = toAddr,
        lastDenom' = denom,
        lastWasSuccess' = true,
      }
      | BankErr(msg) => all {
        balances' = balances,
        supply' = supply,
        _lastError' = msg,
        tick' = tick + 1,
        successes' = successes,
        failures' = failures + 1,
        lastAmount' = amount,
        lastFrom' = fromAddr,
        lastTo' = toAddr,
        lastDenom' = denom,
        lastWasSuccess' = false,
      }
    }
  }

  action protocolStep = any {
    nondet fromAddr = oneOf(ADDR)
    nondet toAddr = oneOf(ADDR)
    nondet denom = oneOf(DENOM)
    nondet amount = (-10).to(supply.get(denom)).oneOf()
    sendTracked(fromAddr, toAddr, denom, amount)
  }

  def drawAccount(addr: Addr, left: int): bool = {
    val banana = balanceOf(addr, "banana")
    val burger = balanceOf(addr, "burger")
    val bananaHeight = barHeight(banana)
    val burgerHeight = barHeight(burger)
    all {
      rlDrawText(addr, left, 180, 22, 255, 255, 255) == 0,
      rlDrawRect(left + 4, 360 - bananaHeight, 36, bananaHeight, 253, 249, 0) == 0,
      rlDrawRect(left + 52, 360 - burgerHeight, 36, burgerHeight, 230, 41, 55) == 0,
      rlDrawTextInt("ban ", banana, left - 10, 374, 18, 253, 249, 0) == 0,
      rlDrawTextInt("bur ", burger, left - 10, 398, 18, 230, 41, 55) == 0,
      if (lastFrom == addr) rlDrawCircle(left + 12, 165, 8, 255, 161, 0) == 0 else true,
      if (lastTo == addr) rlDrawCircle(left + 80, 165, 8, 0, 228, 48) == 0 else true,
    }
  }

  action keepState = all {
    supply' = supply,
    balances' = balances,
    _lastError' = _lastError,
    tick' = tick,
    successes' = successes,
    failures' = failures,
    lastAmount' = lastAmount,
    lastFrom' = lastFrom,
    lastTo' = lastTo,
    lastDenom' = lastDenom,
    lastWasSuccess' = lastWasSuccess,
  }

  action renderFrame = all {
    keepState,
    rlClearScene == 0,
    rlSetCounter(tick) == 0,
    rlDrawText("Cosmos bank live debugger", 20, 60, 28, 255, 255, 255) == 0,
    rlDrawText("Bun + TypeScript backend for big-int-safe specs", 20, 96, 14, 200, 200, 200) == 0,
    rlDrawTextInt("successes ", successes, 20, 132, 20, 0, 228, 48) == 0,
    rlDrawTextInt("failures ", failures, 20, 158, 20, 230, 41, 55) == 0,
    rlDrawText("last from", 260, 132, 18, 200, 200, 200) == 0,
    rlDrawText(lastFrom, 360, 132, 18, 255, 255, 255) == 0,
    rlDrawText("last to", 260, 158, 18, 200, 200, 200) == 0,
    rlDrawText(lastTo, 360, 158, 18, 255, 255, 255) == 0,
    rlDrawText("last denom", 260, 184, 18, 200, 200, 200) == 0,
    rlDrawText(lastDenom, 392, 184, 18, 255, 255, 255) == 0,
    rlDrawTextInt("last amount ", lastAmount, 260, 210, 18, 255, 255, 255) == 0,
    if (lastWasSuccess)
      rlDrawText("last operation succeeded", 20, 224, 20, 0, 228, 48) == 0
    else
      rlDrawText("last operation failed", 20, 224, 20, 230, 41, 55) == 0,
    if (_lastError == "")
      rlDrawText("last error: none", 20, 252, 18, 200, 200, 200) == 0
    else
      rlDrawText(_lastError, 20, 252, 18, 230, 41, 55) == 0,
    if (totalSupplyInv)
      rlDrawText("total supply invariant: OK", 520, 132, 20, 0, 228, 48) == 0
    else
      rlDrawText("total supply invariant: BROKEN", 520, 132, 20, 230, 41, 55) == 0,
    rlDrawTextInt("banana supply ", supply.get("banana"), 520, 162, 18, 253, 249, 0) == 0,
    rlDrawTextInt("burger supply ", supply.get("burger"), 520, 186, 18, 230, 41, 55) == 0,
    rlDrawText("balances", 20, 330, 22, 255, 255, 255) == 0,
    drawAccount("king", 40),
    drawAccount("donkeykong", 220),
    drawAccount("peaches", 420),
    drawAccount("mario", 600),
  }

  action waitFrame = all {
    keepState,
    rlSleepMillis(40) == 0,
  }

  action liveInit = init.then(renderFrame).then(waitFrame)
  action liveStep = protocolStep.then(renderFrame).then(waitFrame)
}
