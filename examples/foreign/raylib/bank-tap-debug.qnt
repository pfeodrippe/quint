module bankTapDebug {
  import bank.* from "../../cosmos/bank/bank"

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

  pure def tapPortalListener(eventJson: str): bool

  pure val ADDR = Set("king", "donkeykong", "peaches", "mario")
  pure val DENOM = Set("banana", "burger")
  pure val MAX_AMOUNT = 10_000

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

  def tapSnapshot = {
    {
      tick: tick,
      successes: successes,
      failures: failures,
      last: {
        from: lastFrom,
        to: lastTo,
        denom: lastDenom,
        amount: lastAmount,
        ok: lastWasSuccess,
        error: _lastError
      },
      supply: supply,
      balances: balances
    }
  }

  def emitSnapshot(snapshot) = {
    q::tap("bank snapshot", snapshot) == snapshot
  }

  action init = {
    val nextSupply = DENOM.mapBy(d => MAX_AMOUNT)
    val nextBalances = Map("king" -> DENOM.mapBy(d => MAX_AMOUNT))
    val snapshot = {
      tick: 0,
      successes: 0,
      failures: 0,
      last: {
        from: "king",
        to: "king",
        denom: "banana",
        amount: 0,
        ok: true,
        error: ""
      },
      supply: nextSupply,
      balances: nextBalances
    }
    all {
      supply' = nextSupply,
      balances' = nextBalances,
      _lastError' = "",
      tick' = 0,
      successes' = 0,
      failures' = 0,
      lastAmount' = 0,
      lastFrom' = "king",
      lastTo' = "king",
      lastDenom' = "banana",
      lastWasSuccess' = true,
      emitSnapshot(snapshot),
    }
  }

  action sendTracked(fromAddr: Addr, toAddr: Addr, denom: Denom, amount: Int256): bool = all {
    val ctx = stateToCtx(tick)
    val result = SendKeeper::SendCoins(ctx, fromAddr, toAddr, Map(denom -> amount))
    match result {
      | BankOk(newCtx) => {
        val nextTick = tick + 1
        val nextSuccesses = successes + 1
        val snapshot = {
          tick: nextTick,
          successes: nextSuccesses,
          failures: failures,
          last: {
            from: fromAddr,
            to: toAddr,
            denom: denom,
            amount: amount,
            ok: true,
            error: ""
          },
          supply: supply,
          balances: newCtx.balances
        }
        all {
          balances' = newCtx.balances,
          supply' = supply,
          _lastError' = "",
          tick' = nextTick,
          successes' = nextSuccesses,
          failures' = failures,
          lastAmount' = amount,
          lastFrom' = fromAddr,
          lastTo' = toAddr,
          lastDenom' = denom,
          lastWasSuccess' = true,
          emitSnapshot(snapshot),
        }
      }
      | BankErr(msg) => {
        val nextTick = tick + 1
        val nextFailures = failures + 1
        val snapshot = {
          tick: nextTick,
          successes: successes,
          failures: nextFailures,
          last: {
            from: fromAddr,
            to: toAddr,
            denom: denom,
            amount: amount,
            ok: false,
            error: msg
          },
          supply: supply,
          balances: balances
        }
        all {
          balances' = balances,
          supply' = supply,
          _lastError' = msg,
          tick' = nextTick,
          successes' = successes,
          failures' = nextFailures,
          lastAmount' = amount,
          lastFrom' = fromAddr,
          lastTo' = toAddr,
          lastDenom' = denom,
          lastWasSuccess' = false,
          emitSnapshot(snapshot),
        }
      }
    }
  }

  action protocolStep =
    any {
      nondet fromAddr = oneOf(ADDR)
      nondet toAddr = oneOf(ADDR)
      nondet denom = oneOf(DENOM)
      nondet amount = (-10).to(supply.get(denom)).oneOf()
      sendTracked(fromAddr, toAddr, denom, amount)
    }
}
