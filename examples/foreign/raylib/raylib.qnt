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

  val defaultFrames = 240

  pure def runHelloDemo(frames: int): bool = showHelloWindow(frames) == 0

  pure def drawCounterScene(counter: int): bool = all {
    rlClearScene == 0,
    rlSetCounter(counter) == 0,
    rlDrawText("Hello from Quint foreign bindings", 120, 120, 30, 255, 255, 255) == 0,
    rlDrawCircle(400, 280, 70, 0, 121, 241) == 0,
  }
}
