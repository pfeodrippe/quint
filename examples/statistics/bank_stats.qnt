module bankStats {
  import bank as B from "../cosmos/bank/bank"
  import bankTest as T from "../cosmos/bank/bankTest"

  pure val REPORT_LIMIT = 40

  var ticks: int
  var reported: bool
  var successCount: int
  var failureCount: int
  var negativeAttempts: int
  var zeroAttempts: int
  var maxActiveAccountsSeen: int
  var maxBalancePositionsSeen: int
  var maxHoldingSeen: int

  pure def activeAccounts(balances) = balances.keys().size()

  def sendResult(fromAddr, toAddr, denom, amt) =
    B::SendKeeper::SendCoins(T::stateToCtx(0), fromAddr, toAddr, Set(denom).mapBy(d => amt))

  pure def sendSucceeded(result) = match result {
    | BankOk(_) => true
    | BankErr(_) => false
  }

  def nextBalances(fromAddr, toAddr, denom, amt) = match sendResult(fromAddr, toAddr, denom, amt) {
    | BankOk(ctx) => ctx.balances
    | BankErr(_) => T::balances
  }

  pure def balancePositions(balances) =
    balances.keys().fold(0, (sum, addr) => sum + balances.get(addr).keys().size())

  pure def maxHolding(balances) =
    balances.keys().fold(0, (best, addr) => {
      val coins = balances.get(addr)
      val accountBest =
        coins.keys().fold(0, (bestAmt, denom) =>
          if (bestAmt < coins.get(denom)) coins.get(denom) else bestAmt
        )
      if (best < accountBest) accountBest else best
    })

  def totalSupply = T::supply.keys().fold(0, (sum, denom) => sum + T::supply.get(denom))

  def finished = ticks == REPORT_LIMIT

  action init = all {
    T::init,
    ticks' = 0,
    reported' = false,
    successCount' = 0,
    failureCount' = 0,
    negativeAttempts' = 0,
    zeroAttempts' = 0,
    maxActiveAccountsSeen' = 1,
    maxBalancePositionsSeen' = 2,
    maxHoldingSeen' = 10_000,
  }

  action protocolStep(fromAddr: str, toAddr: str, denom: str, amt: int): bool = all {
    ticks < REPORT_LIMIT,
    q::tap("bank.requested_amount_each_step", amt) == amt,
    q::tap(
      "bank.transfer_outcome_each_step",
      if (sendSucceeded(sendResult(fromAddr, toAddr, denom, amt))) "ok" else "err"
    ) == if (sendSucceeded(sendResult(fromAddr, toAddr, denom, amt))) "ok" else "err",
    q::tap(
      "bank.active_accounts_each_step",
      activeAccounts(nextBalances(fromAddr, toAddr, denom, amt))
    ) == activeAccounts(nextBalances(fromAddr, toAddr, denom, amt)),
    q::tap(
      "bank.balance_positions_each_step",
      balancePositions(nextBalances(fromAddr, toAddr, denom, amt))
    ) == balancePositions(nextBalances(fromAddr, toAddr, denom, amt)),
    T::send(fromAddr, toAddr, Set(denom).mapBy(d => amt)),
    ticks' = ticks + 1,
    reported' = reported,
    successCount' =
      if (sendSucceeded(sendResult(fromAddr, toAddr, denom, amt))) successCount + 1 else successCount,
    failureCount' =
      if (sendSucceeded(sendResult(fromAddr, toAddr, denom, amt))) failureCount else failureCount + 1,
    negativeAttempts' = if (amt < 0) negativeAttempts + 1 else negativeAttempts,
    zeroAttempts' = if (amt == 0) zeroAttempts + 1 else zeroAttempts,
    maxActiveAccountsSeen' =
      if (maxActiveAccountsSeen < activeAccounts(nextBalances(fromAddr, toAddr, denom, amt)))
        activeAccounts(nextBalances(fromAddr, toAddr, denom, amt))
      else
        maxActiveAccountsSeen,
    maxBalancePositionsSeen' =
      if (maxBalancePositionsSeen < balancePositions(nextBalances(fromAddr, toAddr, denom, amt)))
        balancePositions(nextBalances(fromAddr, toAddr, denom, amt))
      else
        maxBalancePositionsSeen,
    maxHoldingSeen' =
      if (maxHoldingSeen < maxHolding(nextBalances(fromAddr, toAddr, denom, amt)))
        maxHolding(nextBalances(fromAddr, toAddr, denom, amt))
      else
        maxHoldingSeen,
  }

  action report = all {
    finished,
    not(reported),
    q::tap("bank.report_steps", ticks) == ticks,
    q::tap("bank.successful_sends", successCount) == successCount,
    q::tap("bank.failed_sends", failureCount) == failureCount,
    q::tap("bank.negative_attempts", negativeAttempts) == negativeAttempts,
    q::tap("bank.zero_attempts", zeroAttempts) == zeroAttempts,
    q::tap("bank.active_accounts", activeAccounts(T::balances)) == activeAccounts(T::balances),
    q::tap("bank.balance_positions", balancePositions(T::balances)) == balancePositions(T::balances),
    q::tap("bank.max_active_accounts_seen", maxActiveAccountsSeen) == maxActiveAccountsSeen,
    q::tap("bank.max_balance_positions_seen", maxBalancePositionsSeen) == maxBalancePositionsSeen,
    q::tap("bank.max_holding_seen", maxHoldingSeen) == maxHoldingSeen,
    q::tap("bank.last_error", if (T::_lastError == "") "none" else T::_lastError) ==
      if (T::_lastError == "") "none" else T::_lastError,
    q::tap("bank.total_supply", totalSupply) == totalSupply,
    T::supply' = T::supply,
    T::balances' = T::balances,
    T::_lastError' = T::_lastError,
    ticks' = ticks,
    reported' = true,
    successCount' = successCount,
    failureCount' = failureCount,
    negativeAttempts' = negativeAttempts,
    zeroAttempts' = zeroAttempts,
    maxActiveAccountsSeen' = maxActiveAccountsSeen,
    maxBalancePositionsSeen' = maxBalancePositionsSeen,
    maxHoldingSeen' = maxHoldingSeen,
  }

  action step = any {
    nondet fromAddr = oneOf(T::ADDR)
    nondet toAddr = oneOf(T::ADDR)
    nondet denom = oneOf(T::DENOM)
    nondet amt = (-10).to(T::supply.get(denom)).oneOf()
    protocolStep(fromAddr, toAddr, denom, amt),
    report,
  }

  val totalSupplyInv = T::totalSupplyInv
}
