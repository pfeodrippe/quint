#!/usr/bin/env bun

import { dlopen, FFIType } from 'bun:ffi'
import { existsSync, readFileSync, statSync } from 'fs'

type ItfInt = { '#bigint': string }
type ItfSet = { '#set': unknown[] }
type ItfMap = { '#map': [unknown, unknown][] }
type TapEvent = {
  type: 'tap'
  sequence: number
  backend: string
  timestamp: number
  reference?: string | number
  location?: { source: string; start: { line: number; col: number } }
  label: string
  value: unknown
}

const KEY_DOWN = 264n
const KEY_UP = 265n
const KEY_HOME = 268n
const KEY_END = 269n

const [, , tapFile, libraryPath, titleArg] = Bun.argv

if (!tapFile || !libraryPath) {
  console.error('Usage: bun tap-portal.ts <tap-file.jsonl> <library-path> [title]')
  process.exit(1)
}

const title = titleArg ?? 'Quint tap portal'

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

let events: TapEvent[] = []
let selectedIndex = 0
let previousSize = -1

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

function closeWindow() {
  ffi.symbols.rl_close_window_host()
}

function keyPressed(key: bigint): boolean {
  return Boolean(ffi.symbols.rl_is_key_pressed_host(key))
}

function sleepMs(milliseconds: number) {
  ffi.symbols.rl_sleep_millis_host(i64(milliseconds))
}

function refreshEvents() {
  if (!existsSync(tapFile)) {
    return
  }

  const size = statSync(tapFile).size
  if (size === previousSize) {
    return
  }

  previousSize = size
  const followLatest = selectedIndex >= events.length - 1
  const content = readFileSync(tapFile, 'utf8').trim()
  events = content === '' ? [] : content.split('\n').map(line => JSON.parse(line) as TapEvent)

  if (events.length === 0) {
    selectedIndex = 0
  } else if (followLatest) {
    selectedIndex = events.length - 1
  } else if (selectedIndex >= events.length) {
    selectedIndex = events.length - 1
  }
}

function asBigInt(value: unknown): bigint {
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  if (typeof value === 'bigint') return value
  if (value && typeof value === 'object' && '#bigint' in value) return BigInt((value as ItfInt)['#bigint'])
  return 0n
}

function asMapEntries(value: unknown): [unknown, unknown][] {
  if (value && typeof value === 'object' && '#map' in value) {
    return (value as ItfMap)['#map']
  }
  return []
}

function asSet(value: unknown): unknown[] {
  if (value && typeof value === 'object' && '#set' in value) {
    return (value as ItfSet)['#set']
  }
  return []
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('#map' in value) && !('#set' in value) && !('#bigint' in value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function mapKeys(value: unknown): string[] {
  return asMapEntries(value).map(([key]) => String(key))
}

function mapGet(value: unknown, key: string): unknown | undefined {
  for (const [entryKey, entryValue] of asMapEntries(value)) {
    if (String(entryKey) === key) {
      return entryValue
    }
  }
  return undefined
}

function formatInt(value: unknown): string {
  return asBigInt(value).toString()
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`
}

function stringifyValue(value: unknown, depth = 0): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (value && typeof value === 'object' && '#bigint' in value) return (value as ItfInt)['#bigint']
  if (Array.isArray(value)) {
    if (depth >= 2) return `[${value.length} items]`
    return `[${value.map(item => stringifyValue(item, depth + 1)).join(', ')}]`
  }
  if (value && typeof value === 'object' && '#set' in value) {
    const items = asSet(value)
    if (depth >= 2) return `Set(${items.length})`
    return `Set(${items.map(item => stringifyValue(item, depth + 1)).join(', ')})`
  }
  if (value && typeof value === 'object' && '#map' in value) {
    const entries = asMapEntries(value)
    if (depth >= 2) return `Map(${entries.length})`
    return `Map(${entries.map(([key, entryValue]) => `${stringifyValue(key, depth + 1)} -> ${stringifyValue(entryValue, depth + 1)}`).join(', ')})`
  }
  if (value && typeof value === 'object' && 'tag' in value) {
    const record = value as Record<string, unknown>
    if ('value' in record) {
      return `${String(record.tag)}(${stringifyValue(record.value, depth + 1)})`
    }
    return String(record.tag)
  }
  const record = asRecord(value)
  const entries = Object.entries(record)
  if (depth >= 2) return `{${entries.length} fields}`
  return `{ ${entries.map(([key, entryValue]) => `${key}: ${stringifyValue(entryValue, depth + 1)}`).join(', ')} }`
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current === '' ? word : `${current} ${word}`
    if (next.length <= width) {
      current = next
    } else {
      if (current !== '') {
        lines.push(current)
      }
      current = word
    }
  }
  if (current !== '') {
    lines.push(current)
  }
  return lines
}

function summaryFor(event: TapEvent): string {
  const record = asRecord(event.value)
  if ('tick' in record && 'last' in record) {
    const last = asRecord(record.last)
    const amount = formatInt(last.amount)
    const from = String(last.from ?? '?')
    const to = String(last.to ?? '?')
    const denom = String(last.denom ?? '?')
    const ok = last.ok === true ? 'ok' : 'err'
    return `#${event.sequence} ${clip(event.label, 14)} t=${formatInt(record.tick)} ${ok}`
  }
  return `#${event.sequence} ${clip(event.label, 18)} ${clip(stringifyValue(event.value), 18)}`
}

function looksLikeBankTap(value: unknown): boolean {
  const record = asRecord(value)
  return 'balances' in record && 'supply' in record && 'last' in record
}

function drawSidebar() {
  drawRect(12, 56, 278, 410, 28, 34, 46)
  drawText(title, 20, 20, 28, 255, 255, 255)
  drawText(clip(tapFile, 52), 20, 52, 14, 180, 180, 180)
  drawText(`events ${events.length}`, 20, 76, 18, 255, 255, 255)
  drawText('Up/Down select  Home/End jump', 20, 100, 16, 180, 180, 180)

  if (events.length === 0) {
    drawText('Waiting for q::tap events...', 20, 140, 18, 255, 255, 255)
    return
  }

  const first = Math.max(0, selectedIndex - 10)
  const visible = events.slice(first, first + 16)
  visible.forEach((event, index) => {
    const row = first + index
    const y = 138 + index * 20
    if (row === selectedIndex) {
      drawRect(18, y - 2, 266, 18, 56, 107, 214)
    }
    drawText(clip(summaryFor(event), 34), 24, y, 16, 255, 255, 255)
  })
}

function drawBankTap(event: TapEvent) {
  const record = asRecord(event.value)
  const last = asRecord(record.last)
  const supply = record.supply
  const balances = record.balances
  const addresses = mapKeys(balances)
  const denoms = mapKeys(supply)
  const maxBalance = addresses
    .flatMap(addr => denoms.map(denom => asBigInt(mapGet(mapGet(balances, addr), denom) ?? 0n)))
    .reduce((best, value) => (value > best ? value : best), 1n)
  const scale = Number(maxBalance) <= 140 ? 1 : Math.ceil(Number(maxBalance) / 140)

  drawText(`tap #${event.sequence}`, 320, 20, 28, 255, 255, 255)
  drawText(event.label, 320, 48, 18, 200, 200, 200)
  if (event.location) {
    drawText(`${event.location.source}:${event.location.start.line + 1}:${event.location.start.col + 1}`, 320, 68, 14, 180, 180, 180)
  }
  drawText(`tick ${formatInt(record.tick)}`, 320, 88, 22, 255, 255, 255)
  drawText(`successes ${formatInt(record.successes)}`, 320, 120, 18, 0, 228, 48)
  drawText(`failures ${formatInt(record.failures)}`, 320, 144, 18, 230, 41, 55)
  drawText(`last ${String(last.from)} -> ${String(last.to)}`, 320, 176, 20, 255, 255, 255)
  drawText(`amount ${formatInt(last.amount)} ${String(last.denom)}`, 320, 202, 18, 255, 255, 255)
  drawText(last.ok === true ? 'last transfer succeeded' : 'last transfer failed', 320, 226, 18, last.ok === true ? 0 : 230, last.ok === true ? 228 : 41, last.ok === true ? 48 : 55)
  drawText(last.error === '' ? 'last error: none' : clip(`last error: ${String(last.error)}`, 42), 320, 250, 16, 200, 200, 200)

  denoms.forEach((denom, index) => {
    const color = index === 0 ? [253, 249, 0] : [230, 41, 55]
    drawText(
      `${denom} supply ${formatInt(mapGet(supply, denom))}`,
      620,
      92 + index * 24,
      18,
      color[0],
      color[1],
      color[2]
    )
  })

  drawText('balances', 320, 274, 22, 255, 255, 255)

  addresses.forEach((addr, index) => {
    const left = 340 + index * 150
    drawText(addr, left, 304, 18, 255, 255, 255)
    denoms.slice(0, 2).forEach((denom, denomIndex) => {
      const amount = asBigInt(mapGet(mapGet(balances, addr), denom) ?? 0n)
      const height = Math.min(140, Math.max(0, Math.floor(Number(amount) / scale)))
      const x = left + denomIndex * 44
      const color = denomIndex === 0 ? [253, 249, 0] : [230, 41, 55]
      drawRect(x, 450 - height, 28, height, color[0], color[1], color[2])
      drawText(clip(`${denom}: ${amount}`, 14), left - 6, 456 + denomIndex * 18, 14, color[0], color[1], color[2])
    })
    if (String(last.from) === addr) {
      drawCircle(left + 4, 290, 6, 255, 161, 0)
    }
    if (String(last.to) === addr) {
      drawCircle(left + 28, 290, 6, 0, 228, 48)
    }
  })
}

function drawGenericTap(event: TapEvent) {
  drawText(`tap #${event.sequence}`, 320, 20, 28, 255, 255, 255)
  drawText(event.label, 320, 56, 18, 200, 200, 200)
  if (event.location) {
    drawText(`${event.location.source}:${event.location.start.line + 1}:${event.location.start.col + 1}`, 320, 80, 14, 180, 180, 180)
  }
  drawText(`backend ${event.backend}`, 320, 100, 18, 200, 200, 200)
  const lines = wrapText(stringifyValue(event.value), 52)
  lines.slice(0, 18).forEach((line, index) => {
    drawText(line, 320, 136 + index * 20, 18, 255, 255, 255)
  })
}

function handleInput() {
  if (keyPressed(KEY_UP)) {
    selectedIndex = Math.max(0, selectedIndex - 1)
  }
  if (keyPressed(KEY_DOWN)) {
    selectedIndex = Math.min(events.length - 1, selectedIndex + 1)
  }
  if (keyPressed(KEY_HOME)) {
    selectedIndex = 0
  }
  if (keyPressed(KEY_END)) {
    selectedIndex = Math.max(0, events.length - 1)
  }
}

while (!windowShouldClose()) {
  refreshEvents()
  handleInput()
  beginFrame()
  clearScene()
  setCounter(events.length)
  drawSidebar()

  if (events.length > 0) {
    const event = events[selectedIndex]
    if (looksLikeBankTap(event.value)) {
      drawBankTap(event)
    } else {
      drawGenericTap(event)
    }
  } else {
    drawText('No tap data yet', 320, 96, 24, 255, 255, 255)
  }

  endFrame()
  sleepMs(40)
}

closeWindow()
