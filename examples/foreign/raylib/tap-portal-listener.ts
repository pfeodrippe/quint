import { dlopen, FFIType } from 'bun:ffi'
import { fileURLToPath } from 'url'
import { join } from 'path'

type ItfInt = { '#bigint': string }
type ItfSet = { '#set': unknown[] }
type ItfMap = { '#map': [unknown, unknown][] }
type TapEvent = {
  type: 'tap'
  sequence: number
  backend: string
  timestamp: number
  reference?: string
  location?: { source: string; start: { line: number; col: number } }
  label: string
  value: unknown
}

type RaylibFfi = ReturnType<typeof dlopen>

let ffi: RaylibFfi | undefined
const events: TapEvent[] = []

function libraryPath() {
  const base = fileURLToPath(new URL('.', import.meta.url))
  switch (process.platform) {
    case 'darwin':
      return join(base, 'native-rust', 'target', 'debug', 'libquint_raylib_demo.dylib')
    case 'linux':
      return join(base, 'native-rust', 'target', 'debug', 'libquint_raylib_demo.so')
    case 'win32':
      return join(base, 'native-rust', 'target', 'debug', 'quint_raylib_demo.dll')
    default:
      throw new Error(`Unsupported platform for raylib tap portal listener: ${process.platform}`)
  }
}

function getFfi() {
  if (!ffi) {
    ffi = dlopen(libraryPath(), {
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
      rl_close_window_host: { args: [], returns: FFIType.i64 },
    })
    process.on('exit', () => {
      try {
        ffi?.symbols.rl_close_window_host()
      } catch {
        // Ignore shutdown errors from the native window host.
      }
    })
  }
  return ffi
}

function i64(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(Math.trunc(value))
}

function cstring(text: string): Buffer {
  return Buffer.from(`${text}\0`, 'utf8')
}

function drawText(text: string, x: number, y: number, fontSize: number, r: number, g: number, b: number) {
  getFfi().symbols.rl_draw_text_host(cstring(text), i64(x), i64(y), i64(fontSize), i64(r), i64(g), i64(b))
}

function drawRect(x: number, y: number, width: number, height: number, r: number, g: number, b: number) {
  getFfi().symbols.rl_draw_rect_host(i64(x), i64(y), i64(width), i64(height), i64(r), i64(g), i64(b))
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`
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
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !('#map' in value) &&
    !('#set' in value) &&
    !('#bigint' in value)
  ) {
    return value as Record<string, unknown>
  }
  return {}
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
  const record = asRecord(value)
  const entries = Object.entries(record)
  if (entries.length === 0) return '{}'
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

function formatLocation(event: TapEvent): string {
  if (!event.location) {
    return 'no source location'
  }
  return `${event.location.source}:${event.location.start.line + 1}:${event.location.start.col + 1}`
}

function summaryFor(event: TapEvent): string {
  const record = asRecord(event.value)
  if ('tick' in record && 'last' in record) {
    const last = asRecord(record.last)
    const verdict = last.ok === true ? 'ok' : 'err'
    return `#${event.sequence} ${clip(event.label, 18)} t=${asBigInt(record.tick)} ${verdict}`
  }
  return `#${event.sequence} ${clip(event.label, 24)}`
}

function draw() {
  const current = events[events.length - 1]
  if (!current) {
    return
  }

  const host = getFfi()
  host.symbols.rl_begin_frame_host()
  host.symbols.rl_clear_scene_host()
  host.symbols.rl_set_counter_host(i64(events.length))

  drawText('Quint q::tap live listener', 20, 20, 28, 255, 255, 255)
  drawText('Direct operator listener via foreign bindings (no JSONL middleman)', 20, 54, 16, 180, 180, 180)
  drawText(`events ${events.length}`, 20, 82, 18, 255, 255, 255)

  drawRect(18, 112, 430, 330, 28, 34, 46)
  drawText('recent taps', 28, 122, 22, 255, 255, 255)

  const recent = events.slice(-14)
  recent.forEach((event, index) => {
    const y = 156 + index * 20
    if (event === current) {
      drawRect(24, y - 2, 416, 18, 56, 107, 214)
    }
    drawText(clip(summaryFor(event), 40), 30, y, 16, 255, 255, 255)
  })

  drawRect(470, 112, 500, 330, 28, 34, 46)
  drawText('latest tap', 480, 122, 22, 255, 255, 255)
  drawText(current.label, 480, 154, 20, 255, 255, 255)
  drawText(formatLocation(current), 480, 182, 14, 180, 180, 180)
  drawText(`backend ${current.backend}  sequence ${current.sequence}`, 480, 206, 16, 200, 200, 200)

  const lines = wrapText(stringifyValue(current.value), 58)
  lines.slice(0, 10).forEach((line, index) => {
    drawText(line, 480, 240 + index * 20, 18, 255, 255, 255)
  })

  host.symbols.rl_end_frame_host()
}

export function tapPortalListener(eventJson: string): boolean {
  const event = JSON.parse(eventJson) as TapEvent
  events.push(event)
  if (events.length > 200) {
    events.splice(0, events.length - 200)
  }
  draw()
  return true
}
