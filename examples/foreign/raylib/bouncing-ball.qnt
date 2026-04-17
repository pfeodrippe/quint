module raylibDemo {
  pure def showHelloWindow(frames: int): int

  pure def rlClearScene(): int
  pure def rlDrawText(text: str, x: int, y: int, fontSize: int, r: int, g: int, b: int): int
  pure def rlDrawTextInt(prefix: str, value: int, x: int, y: int, fontSize: int, r: int, g: int, b: int): int
  pure def rlDrawCircle(x: int, y: int, radius: int, r: int, g: int, b: int): int
  pure def rlDrawRect(x: int, y: int, width: int, height: int, r: int, g: int, b: int): int
  pure def rlSleepMillis(milliseconds: int): int
  pure def rlSetCounter(value: int): int
  pure def rlWindowShouldClose(): bool
  pure def rlCloseWindow(): int
}

module bouncingBallLive {
  import raylibDemo.*

  val width = 800
  val height = 450
  val radius = 20

  var x: int
  var y: int
  var vx: int
  var vy: int
  var tick: int

  val nextVx = if ((x + vx < radius).or(x + vx > width - radius)) (0 - vx) else vx
  val nextVy = if ((y + vy < radius).or(y + vy > height - radius)) (0 - vy) else vy

  action init = all {
    x' = 160,
    y' = 120,
    vx' = 6,
    vy' = 4,
    tick' = 0,
  }

  action step = all {
    x' = x + nextVx,
    y' = y + nextVy,
    vx' = nextVx,
    vy' = nextVy,
    tick' = tick + 1,
  }

  val scene = {
    tick: tick,
    position: { x: x, y: y },
    velocity: { x: vx, y: vy },
  }

  pure def drawState(ballX: int, ballY: int, currentTick: int): bool = all {
    rlClearScene == 0,
    rlSetCounter(currentTick) == 0,
    rlDrawText("Bouncing ball spec", 20, 60, 24, 255, 255, 255) == 0,
    rlDrawText("Run init, step, drawCurrentState in the REPL", 20, 92, 20, 200, 200, 200) == 0,
    rlDrawCircle(ballX, ballY, radius, 0, 121, 241) == 0,
  }

  val drawCurrentState = drawState(x, y, tick)

  val insideBounds =
    x >= radius and
    x <= width - radius and
    y >= radius and
    y <= height - radius
}
