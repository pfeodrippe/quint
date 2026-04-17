#!/usr/bin/env bun

import { dlopen, FFIType } from 'bun:ffi'
import { readdirSync, readFileSync } from 'fs'
import { basename, join } from 'path'

type ItfInt = { '#bigint': string }
type ItfTuple = { '#tup': unknown[] }
type ItfSet = { '#set': unknown[] }
type ItfMap = { '#map': [unknown, unknown][] }
type ItfVariant = { tag: string; value: unknown }
type ItfState = Record<string, unknown>
type ItfTraceFile = {
  '#meta'?: { status?: string; source?: string }
  vars: string[]
  states: ItfState[]
}

type LoadedTrace = {
  name: string
  status: string
  source: string
  states: ItfState[]
}

type RendererKind = 'bank' | 'two-phase'

const KEY_RIGHT = 262n
const KEY_LEFT = 263n
const KEY_DOWN = 264n
const KEY_UP = 265n
const KEY_PAGE_UP = 266n
const KEY_PAGE_DOWN = 267n
const KEY_HOME = 268n
const KEY_END = 269n
const KEY_R = 82n

const [, , rendererArg, traceDir, libraryPath] = Bun.argv

if (!rendererArg || !traceDir || !libraryPath) {
  console.error('Usage: bun trace-debugger.ts <bank|two-phase> <trace-dir> <library-path>')
  process.exit(1)
}

if (rendererArg !== 'bank' && rendererArg !== 'two-phase') {
  console.error(`Unsupported renderer '${rendererArg}'`)
  process.exit(1)
}

const rendererKind: RendererKind = rendererArg
const traces = loadTraces(traceDir)
if (traces.length === 0) {
  console.error(`No traces found in ${traceDir}`)
  process.exit(1)
}

const lengths = traces.map(trace => trace.states.length)
const stats = {
  count: traces.length,
  minLength: Math.min(...lengths),
  maxLength: Math.max(...lengths),
  avgLength: lengths.reduce((sum, len) => sum + len, 0) / lengths.length,
  okCount: traces.filter(trace => trace.status === 'ok').length,
  violationCount: traces.filter(trace => trace.status !== 'ok').length,
}

const ffi = dlopen(libraryPath, {
  rl_begin_frame_host: { args: [], returns: FFIType.i64 },
  rl_end_frame_host: { args: [], returns: FFIType.i64 },
  rl_clear_scene_host: { args: [], returns: FFIType.i64 },
  rl_set_counter_host: { args: [FFIType.i64], returns: FFIType.i64 },
  rl_draw_text_host: {
    args: [FFIType.cstring, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64],
    returns: FFIType.i64,
  },
  rl_draw_rect_host: {
    args: [FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64],
    returns: FFIType.i64,
  },
  rl_draw_circle_host: {
    args: [FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64],
    returns: FFIType.i64,
  },
  rl_window_should_close_host: { args: [], returns: FFIType.bool },
  rl_close_window_host: { args: [], returns: FFIType.i64 },
  rl_is_key_pressed_host: { args: [FFIType.i64], returns: FFIType.bool },
  rl_sleep_millis_host: { args: [FFIType.i64], returns: FFIType.i64 },
})

let traceIndex = 0
let stateIndex = 0

function i64(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(Math.trunc(value))
}

function cstring(text: string): Buffer {
  return Buffer.from(`${text}\0`, 'utf8')
}

function beginFrame() {
  ffi.symbols.rl_begin_frame_host()
}

function endFrame() {
  ffi.symbols.rl_end_frame_host()
}

function clearScene() {
  ffi.symbols.rl_clear_scene_host()
}

function setCounter(value: number) {
  ffi.symbols.rl_set_counter_host(i64(value))
}

function drawText(text: string, x: number, y: number, fontSize: number, r: number, g: number, b: number) {
  ffi.symbols.rl_draw_text_host(cstring(text), i64(x), i64(y), i64(fontSize), i64(r), i64(g), i64(b))
}

function drawRect(x: number, y: number, width: number, height: number, r: number, g: number, b: number) {
  ffi.symbols.rl_draw_rect_host(i64(x), i64(y), i64(width), i64(height), i64(r), i64(g), i64(b))
}

function drawCircle(x: number, y: number, radius: number, r: number, g: number, b: number) {
  ffi.symbols.rl_draw_circle_host(i64(x), i64(y), i64(radius), i64(r), i64(g), i64(b))
}

function windowShouldClose(): boolean {
  return Boolean(ffi.symbols.rl_window_should_close_host())
}

function keyPressed(key: bigint): boolean {
  return Boolean(ffi.symbols.rl_is_key_pressed_host(key))
}

function sleepMs(milliseconds: number) {
  ffi.symbols.rl_sleep_millis_host(i64(milliseconds))
}

function closeWindow() {
  ffi.symbols.rl_close_window_host()
}

function normalizeSelection() {
  if (traceIndex < 0) traceIndex = 0
  if (traceIndex >= traces.length) traceIndex = traces.length - 1
  const maxState = traces[traceIndex].states.length - 1
  if (stateIndex < 0) stateIndex = 0
  if (stateIndex > maxState) stateIndex = maxState
}

function handleInput() {
  if (keyPressed(KEY_UP)) {
    traceIndex -= 1
  }
  if (keyPressed(KEY_DOWN)) {
    traceIndex += 1
  }
  if (keyPressed(KEY_LEFT)) {
    stateIndex -= 1
  }
  if (keyPressed(KEY_RIGHT)) {
    stateIndex += 1
  }
  if (keyPressed(KEY_HOME)) {
    stateIndex = 0
  }
  if (keyPressed(KEY_END)) {
    stateIndex = traces[traceIndex].states.length - 1
  }
  if (keyPressed(KEY_PAGE_UP)) {
    stateIndex -= 10
  }
  if (keyPressed(KEY_PAGE_DOWN)) {
    stateIndex += 10
  }
  if (keyPressed(KEY_R)) {
    stateIndex = 0
  }
  normalizeSelection()
}

function loadTraces(dir: string): LoadedTrace[] {
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as ItfTraceFile
      return {
        name: basename(name, '.json'),
        status: parsed['#meta']?.status ?? 'ok',
        source: parsed['#meta']?.source ?? '',
        states: parsed.states,
      }
    })
}

function asBigInt(value: unknown): bigint {
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  if (typeof value === 'bigint') return value
  if (value && typeof value === 'object' && '#bigint' in value) return BigInt((value as ItfInt)['#bigint'])
  return 0n
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value && typeof value === 'object' && 'tag' in value && typeof (value as ItfVariant).tag === 'string') {
    return (value as ItfVariant).tag
  }
  return String(value ?? '')
}

function asBool(value: unknown): boolean {
  return value === true
}

function asSet(value: unknown): unknown[] {
  if (value && typeof value === 'object' && '#set' in value) return (value as ItfSet)['#set']
  return []
}

function asMapEntries(value: unknown): [unknown, unknown][] {
  if (value && typeof value === 'object' && '#map' in value) return (value as ItfMap)['#map']
  return []
}

function variantTag(value: unknown): string {
  if (value && typeof value === 'object' && 'tag' in value) return (value as ItfVariant).tag
  return ''
}

function mapGet(mapValue: unknown, key: string): unknown | undefined {
  for (const [entryKey, entryValue] of asMapEntries(mapValue)) {
    if (entryKey === key) return entryValue
  }
  return undefined
}

function setHasString(setValue: unknown, key: string): boolean {
  return asSet(setValue).some(value => value === key)
}

function setHasVariantTag(setValue: unknown, tag: string): boolean {
  return asSet(setValue).some(value => variantTag(value) === tag)
}

function formatInt(value: unknown): string {
  return asBigInt(value).toString()
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`
}

function drawTraceSidebar() {
  const sidebarX = 14
  const sidebarY = 58
  const sidebarWidth = 190
  const rowHeight = 28
  const visibleRows = 10
  const start = Math.max(0, Math.min(traceIndex - Math.floor(visibleRows / 2), traces.length - visibleRows))
  const end = Math.min(traces.length, start + visibleRows)

  drawRect(sidebarX, sidebarY, sidebarWidth, 348, 38, 38, 60)
  drawText('Traces', sidebarX + 10, sidebarY + 8, 22, 255, 255, 255)

  for (let i = start; i < end; i++) {
    const trace = traces[i]
    const rowY = sidebarY + 40 + (i - start) * rowHeight
    const selected = i === traceIndex
    if (selected) {
      drawRect(sidebarX + 6, rowY - 2, sidebarWidth - 12, rowHeight - 2, 70, 70, 104)
    }
    const color = trace.status === 'ok' ? [0, 228, 48] : [230, 41, 55]
    drawText(`#${i}`, sidebarX + 14, rowY + 2, 18, 255, 255, 255)
    drawText(trace.status, sidebarX + 50, rowY + 2, 18, color[0], color[1], color[2])
    drawText(`${trace.states.length} st`, sidebarX + 118, rowY + 2, 18, 210, 210, 210)
  }
}

function drawCommonHeader(currentTrace: LoadedTrace) {
  drawText(rendererKind === 'bank' ? 'Bank trace debugger' : 'Two-phase commit trace debugger', 224, 18, 28, 255, 255, 255)
  drawText(
    `trace ${traceIndex + 1}/${stats.count}   state ${stateIndex + 1}/${currentTrace.states.length}   status ${currentTrace.status}`,
    224,
    52,
    18,
    currentTrace.status === 'ok' ? 0 : 230,
    currentTrace.status === 'ok' ? 228 : 41,
    currentTrace.status === 'ok' ? 48 : 55
  )
  drawText(
    `lengths min ${stats.minLength} / avg ${stats.avgLength.toFixed(1)} / max ${stats.maxLength}    ok ${stats.okCount}    non-ok ${stats.violationCount}`,
    224,
    76,
    16,
    200,
    200,
    200
  )
}

function drawInstructions() {
  drawText('Up/Down trace  Left/Right state  PgUp/PgDn jump  Home/End ends  R reset', 20, 424, 16, 200, 200, 200)
}

function renderBankState(state: ItfState) {
  const balances = state.balances
  const supply = state.supply
  const lastError = asString(state._lastError)
  const addresses = ['king', 'donkeykong', 'peaches', 'mario']
  const panelX = 224

  drawText('last from', panelX, 116, 18, 200, 200, 200)
  drawText(asString(state.lastFrom), panelX + 92, 116, 18, 255, 255, 255)
  drawText('last to', panelX, 140, 18, 200, 200, 200)
  drawText(asString(state.lastTo), panelX + 92, 140, 18, 255, 255, 255)
  drawText('last denom', panelX, 164, 18, 200, 200, 200)
  drawText(asString(state.lastDenom), panelX + 112, 164, 18, 255, 255, 255)
  drawText(`last amount ${formatInt(state.lastAmount)}`, panelX, 188, 18, 255, 255, 255)
  drawText(`successes ${formatInt(state.successes)}`, 520, 116, 18, 0, 228, 48)
  drawText(`failures ${formatInt(state.failures)}`, 520, 140, 18, 230, 41, 55)
  drawText(`banana supply ${formatInt(mapGet(supply, 'banana'))}`, 520, 164, 18, 253, 249, 0)
  drawText(`burger supply ${formatInt(mapGet(supply, 'burger'))}`, 520, 188, 18, 230, 41, 55)
  drawText(asBool(state.lastWasSuccess) ? 'last op succeeded' : 'last op failed', panelX, 214, 18, asBool(state.lastWasSuccess) ? 0 : 230, asBool(state.lastWasSuccess) ? 228 : 41, asBool(state.lastWasSuccess) ? 48 : 55)
  drawText(lastError === '' ? 'last error: none' : clip(`last error: ${lastError}`, 52), panelX, 238, 16, lastError === '' ? 200 : 230, lastError === '' ? 200 : 41, lastError === '' ? 200 : 55)
  drawText('balances', 224, 280, 22, 255, 255, 255)

  addresses.forEach((address, index) => {
    const x = 230 + index * 136
    const coins = mapGet(balances, address)
    const banana = asBigInt(mapGet(coins, 'banana'))
    const burger = asBigInt(mapGet(coins, 'burger'))
    const bananaHeight = Number((banana / 80n) > 120n ? 120n : banana / 80n)
    const burgerHeight = Number((burger / 80n) > 120n ? 120n : burger / 80n)

    drawText(address, x, 306, 18, 255, 255, 255)
    drawRect(x + 6, 394 - bananaHeight, 28, bananaHeight, 253, 249, 0)
    drawRect(x + 44, 394 - burgerHeight, 28, burgerHeight, 230, 41, 55)
    drawText(clip(`b ${banana}`, 10), x - 4, 402, 14, 253, 249, 0)
    drawText(clip(`r ${burger}`, 10), x - 4, 420, 14, 230, 41, 55)

    if (asString(state.lastFrom) === address) drawCircle(x + 12, 296, 6, 255, 161, 0)
    if (asString(state.lastTo) === address) drawCircle(x + 54, 296, 6, 0, 228, 48)
  })
}

function renderTwoPhaseState(state: ItfState) {
  const rmStates = state['twoPhaseCommitLiveDebug::T::RM::states']
  const prepared = state['twoPhaseCommitLiveDebug::T::TM::preparedRMs']
  const tmState = state['twoPhaseCommitLiveDebug::T::TM::state']
  const messages = state['twoPhaseCommitLiveDebug::T::messages']
  const resourceManagers = ['rm1', 'rm2', 'rm3']

  drawText('TM state', 224, 116, 18, 200, 200, 200)
  const tmTag = variantTag(tmState)
  const tmColor = tmTag === 'TMCommitted' ? [0, 228, 48] : tmTag === 'TMAborted' ? [230, 41, 55] : [0, 121, 241]
  drawText(tmTag, 316, 116, 18, tmColor[0], tmColor[1], tmColor[2])
  drawText(`last action ${asString(state.lastKind)}`, 224, 140, 18, 255, 255, 255)
  drawText(`last actor ${asString(state.lastRm)}`, 224, 164, 18, 255, 255, 255)
  drawText(`prepare steps ${formatInt(state.prepareCount)}`, 520, 116, 18, 253, 249, 0)
  drawText(`commit steps ${formatInt(state.commitCount)}`, 520, 140, 18, 0, 228, 48)
  drawText(`abort steps ${formatInt(state.abortCount)}`, 520, 164, 18, 230, 41, 55)
  drawText(`messages ${asSet(messages).length}`, 520, 188, 18, 255, 255, 255)
  drawText(`prepared rms ${asSet(prepared).length}`, 520, 212, 18, 255, 255, 255)
  drawText(setHasVariantTag(messages, 'Commit') ? 'commit message present' : 'commit message absent', 224, 188, 18, setHasVariantTag(messages, 'Commit') ? 0 : 120, setHasVariantTag(messages, 'Commit') ? 228 : 120, setHasVariantTag(messages, 'Commit') ? 48 : 120)
  drawText(setHasVariantTag(messages, 'Abort') ? 'abort message present' : 'abort message absent', 224, 212, 18, setHasVariantTag(messages, 'Abort') ? 230 : 120, setHasVariantTag(messages, 'Abort') ? 41 : 120, setHasVariantTag(messages, 'Abort') ? 55 : 120)

  resourceManagers.forEach((rm, index) => {
    const x = 230 + index * 176
    const rmState = variantTag(mapGet(rmStates, rm))
    const color =
      rmState === 'Prepared'
        ? [253, 249, 0]
        : rmState === 'Committed'
        ? [0, 228, 48]
        : rmState === 'Aborted'
        ? [230, 41, 55]
        : [0, 121, 241]

    drawText(rm, x, 270, 22, 255, 255, 255)
    drawRect(x, 300, 120, 70, color[0], color[1], color[2])
    drawText(rmState, x + 12, 324, 18, 20, 20, 20)
    drawText(setHasString(prepared, rm) ? 'prepared' : 'not prepared', x, 382, 16, 220, 220, 220)
    drawText(setHasVariantTag(messages, 'RMPrepared') ? 'msgs tracked globally' : 'no RMPrepared msg', x, 400, 14, 180, 180, 180)
    if (asString(state.lastRm) === rm) drawCircle(x + 106, 282, 7, 255, 161, 0)
    if (setHasString(prepared, rm)) drawCircle(x + 14, 282, 6, 253, 249, 0)
  })
}

try {
  while (!windowShouldClose()) {
    handleInput()
    const currentTrace = traces[traceIndex]
    const currentState = currentTrace.states[stateIndex]

    beginFrame()
    clearScene()
    setCounter(stateIndex)
    drawTraceSidebar()
    drawCommonHeader(currentTrace)
    if (rendererKind === 'bank') {
      renderBankState(currentState)
    } else {
      renderTwoPhaseState(currentState)
    }
    drawInstructions()
    endFrame()
    sleepMs(16)
  }
} finally {
  closeWindow()
}
