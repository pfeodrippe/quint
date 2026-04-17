import { appendFileSync } from 'fs'

import { Either, left, right } from '@sweet-monads/either'

import { Loc } from './ErrorMessage'
import { prettyQuintEx, terminalWidth } from './graphics'
import { QuintEx } from './ir/quintIr'
import { ItfValue, ofItfValue, toItfValue } from './itf'
import { zerog } from './idGenerator'
import { QuintError } from './quintError'
import { format } from './prettierimp'

export type TapBackend = 'typescript' | 'rust'

export interface TapEvent {
  sequence: number
  backend: TapBackend
  timestamp: number
  reference?: bigint
  location?: Loc
  label: string
  value: QuintEx
  itfValue: ItfValue
}

interface TapListener {
  spec: string
  onTap(event: TapEvent): void
  close?(): void
  disabled?: boolean
}

function tapError(code: QuintError['code'], message: string): QuintError {
  return { code, message }
}

function parseListenerSpec(spec: string, out: (text: string) => void): Either<QuintError, TapListener> {
  if (spec === 'stdout') {
    return right({
      spec,
      onTap(event) {
        const rendered = format(terminalWidth(), 0, prettyQuintEx(event.value))
        out(`[TAP] ${event.label} ${rendered}\n`)
      },
    })
  }

  if (spec.startsWith('jsonl:')) {
    const path = spec.slice('jsonl:'.length)
    if (path.trim() === '') {
      return left(tapError('QNT528', 'Tap listener jsonl: requires a file path'))
    }
    try {
      appendFileSync(path, '', { encoding: 'utf8' })
    } catch (error) {
      return left(
        tapError(
          'QNT528',
          `Failed to initialize tap listener ${spec}: ${error instanceof Error ? error.message : String(error)}`
        )
      )
    }
    return right({
      spec,
      onTap(event) {
        appendFileSync(
          path,
          `${JSON.stringify({
            type: 'tap',
            sequence: event.sequence,
            backend: event.backend,
            timestamp: event.timestamp,
            reference: event.reference?.toString(),
            location: event.location,
            label: event.label,
            value: event.itfValue,
          })}\n`,
          { encoding: 'utf8' }
        )
      },
    })
  }

  return left(
    tapError(
      'QNT528',
      `Unsupported tap listener '${spec}'. Supported listeners are: stdout, jsonl:/absolute/or/relative/path.jsonl`
    )
  )
}

export function normalizeTapListenerSpecs(value: unknown): string[] {
  if (value === undefined || value === null) {
    return []
  }
  if (Array.isArray(value)) {
    return value.flatMap(v => String(v).split(',')).map(v => v.trim()).filter(v => v !== '')
  }
  return String(value)
    .split(',')
    .map(v => v.trim())
    .filter(v => v !== '')
}

export class TapManager {
  private sequence = 0
  private resolveLocation?: (reference: bigint) => Loc | undefined

  constructor(private readonly listeners: TapListener[], resolveLocation?: (reference: bigint) => Loc | undefined) {
    this.resolveLocation = resolveLocation
  }

  get enabled(): boolean {
    return this.listeners.length > 0
  }

  emitQuint(reference: bigint | undefined, label: string, value: QuintEx, backend: TapBackend) {
    const encoded = toItfValue(value)
    if (encoded.isLeft()) {
      console.error(`[tap] failed to encode tapped value: ${encoded.value}`)
      return
    }

    this.emit({
      sequence: this.sequence++,
      backend,
      timestamp: Date.now(),
      reference,
      location: reference !== undefined ? this.resolveLocation?.(reference) : undefined,
      label,
      value,
      itfValue: encoded.value,
    })
  }

  emitItf(reference: bigint | undefined, label: string, value: ItfValue, backend: TapBackend) {
    try {
      this.emit({
        sequence: this.sequence++,
        backend,
        timestamp: Date.now(),
        reference,
        location: reference !== undefined ? this.resolveLocation?.(reference) : undefined,
        label,
        value: ofItfValue(value, zerog.nextId),
        itfValue: value,
      })
    } catch (error) {
      console.error(`[tap] failed to decode tapped value: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  close() {
    for (const listener of this.listeners) {
      if (listener.disabled) {
        continue
      }
      try {
        listener.close?.()
      } catch (error) {
        console.error(
          `[tap] listener ${listener.spec} failed while closing: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
  }

  setLocationResolver(resolveLocation: (reference: bigint) => Loc | undefined) {
    this.resolveLocation = resolveLocation
  }

  private emit(event: TapEvent) {
    for (const listener of this.listeners) {
      if (listener.disabled) {
        continue
      }
      try {
        listener.onTap(event)
      } catch (error) {
        listener.disabled = true
        console.error(
          `[tap] listener ${listener.spec} failed and was disabled: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
  }
}

export function createTapManager(
  specs: string[] | undefined,
  out?: (text: string) => void,
  resolveLocation?: (reference: bigint) => Loc | undefined
): Either<QuintError, TapManager> {
  const writer = out ?? (text => process.stdout.write(text))
  const listeners: TapListener[] = []
  for (const spec of specs ?? []) {
    const listener = parseListenerSpec(spec, writer)
    if (listener.isLeft()) {
      return left(listener.value)
    }
    listeners.push(listener.value)
  }
  return right(new TapManager(listeners, resolveLocation))
}
