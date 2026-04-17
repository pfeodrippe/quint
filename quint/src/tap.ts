import { appendFileSync, writeFileSync } from 'fs'

import { Either, left, right } from '@sweet-monads/either'

import { Loc } from './ErrorMessage'
import { prettyQuintEx, terminalWidth } from './graphics'
import { QuintEx } from './ir/quintIr'
import { ItfValue, ofItfValue, toItfValue } from './itf'
import { zerog } from './idGenerator'
import { NameResolver } from './names/resolver'
import { QuintError } from './quintError'
import { format } from './prettierimp'
import { findBoundDefinition, ForeignBindingRegistry } from './runtime/foreign'
import { rv } from './runtime/impl/runtimeValue'

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

export interface TapListener {
  spec: string
  onTap(event: TapEvent): void
  onTraceStart?(): void
  onTraceEnd?(): void
  close?(): void
  disabled?: boolean
}

type TapStatsScope = 'event' | 'trace'
type TapTraceReducer = 'last' | 'min' | 'max' | 'count' | 'sum'

type StatsListenerConfig = {
  scope: TapStatsScope
  traceReducer?: TapTraceReducer
  jsonPath?: string
}

type TapStatsGroup = {
  location?: Loc
  sampleCount: number
  intValues: bigint[]
  intSum: bigint
  boolCounts: { true: number; false: number }
  stringCounts: Map<string, number>
  otherCounts: Map<string, number>
}

type TapTraceGroup = {
  location?: Loc
  count: number
  last?: ItfValue
  intValue?: bigint
  intSum?: bigint
}

type TapStatsFrequencyEntry = {
  value: string
  count: number
  percentage: number
}

type TapStatsCountSummary = {
  count: number
  distinct: number
  entries: TapStatsFrequencyEntry[]
}

type TapStatsIntSummary = {
  count: number
  min: string
  p50: string
  p90: string
  p99: string
  max: string
  avg: string
}

type TapStatsBoolSummary = {
  count: number
  trueCount: number
  falseCount: number
  truePercentage: number
  falsePercentage: number
}

type TapStatsGroupSummary = {
  label: string
  location?: Loc
  sampleCount: number
  ints?: TapStatsIntSummary
  bools?: TapStatsBoolSummary
  strings?: TapStatsCountSummary
  structures?: TapStatsCountSummary
}

type TapStatsReport = {
  type: 'tap-stats'
  generatedAt: number
  scope: TapStatsScope
  traceReducer?: TapTraceReducer
  groups: TapStatsGroupSummary[]
}

function tapError(code: QuintError['code'], message: string): QuintError {
  return { code, message }
}

function addCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function isItfBigint(value: ItfValue): value is { '#bigint': string } {
  return typeof value === 'object' && value !== null && '#bigint' in value
}

function classifyTapValue(
  value: ItfValue
):
  | { kind: 'int'; value: bigint }
  | { kind: 'bool'; value: boolean }
  | { kind: 'str'; value: string }
  | { kind: 'other'; value: string } {
  if (isItfBigint(value)) {
    return { kind: 'int', value: BigInt(value['#bigint']) }
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { kind: 'int', value: BigInt(value) }
  }
  if (typeof value === 'boolean') {
    return { kind: 'bool', value }
  }
  if (typeof value === 'string') {
    return { kind: 'str', value }
  }
  return { kind: 'other', value: JSON.stringify(value) }
}

function locationToString(location?: Loc): string {
  return location ? ` @ ${location.source}:${location.start.line}:${location.start.col}` : ''
}

function formatPercentage(count: number, total: number): string {
  if (total === 0) {
    return '0.00%'
  }
  return `${((count * 100) / total).toFixed(2)}%`
}

function percentageValue(count: number, total: number): number {
  if (total === 0) {
    return 0
  }
  return Number(((count * 100) / total).toFixed(2))
}

function formatBigInt(value: bigint): string {
  return value.toString()
}

function formatAverage(sum: bigint, count: number): string {
  if (count === 0) {
    return '0.00'
  }

  const divisor = BigInt(count)
  const negative = sum < 0n
  const magnitude = negative ? -sum : sum
  const scaled = (magnitude * 100n + divisor / 2n) / divisor
  const integral = scaled / 100n
  const fractional = (scaled % 100n).toString().padStart(2, '0')
  return `${negative && scaled !== 0n ? '-' : ''}${integral.toString()}.${fractional}`
}

function percentile(values: bigint[], quantile: number): bigint {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1))
  return values[index]
}

function truncate(text: string, limit = 80): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}...`
}

function formatFrequencySummary(
  counts: Map<string, number>,
  total: number,
  renderKey: (key: string) => string
): string {
  const entries = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([key, count]) => `${renderKey(key)}=${count} (${formatPercentage(count, total)})`)

  if (counts.size > 5) {
    entries.push(`... ${counts.size - 5} more`)
  }

  return entries.join(', ')
}

function itfInt(value: bigint): ItfValue {
  return { '#bigint': value.toString() }
}

function createEmptyStatsGroup(location?: Loc): TapStatsGroup {
  return {
    location,
    sampleCount: 0,
    intValues: [],
    intSum: 0n,
    boolCounts: { true: 0, false: 0 },
    stringCounts: new Map<string, number>(),
    otherCounts: new Map<string, number>(),
  }
}

function recordTapSample(
  groups: Map<string, TapStatsGroup>,
  label: string,
  location: Loc | undefined,
  value: ItfValue
) {
  const group = groups.get(label) ?? createEmptyStatsGroup(location)
  if (!groups.has(label)) {
    groups.set(label, group)
  }
  if (!group.location && location) {
    group.location = location
  }

  group.sampleCount += 1
  const sample = classifyTapValue(value)
  switch (sample.kind) {
    case 'int':
      group.intValues.push(sample.value)
      group.intSum += sample.value
      break
    case 'bool':
      group.boolCounts[sample.value ? 'true' : 'false'] += 1
      break
    case 'str':
      addCount(group.stringCounts, sample.value)
      break
    case 'other':
      addCount(group.otherCounts, sample.value)
      break
  }
}

function summarizeCounts(counts: Map<string, number>, total: number): TapStatsCountSummary {
  const entries = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({
      value,
      count,
      percentage: percentageValue(count, total),
    }))

  return {
    count: total,
    distinct: counts.size,
    entries,
  }
}

function buildTapStatsReport(config: StatsListenerConfig, groups: Map<string, TapStatsGroup>): TapStatsReport {
  return {
    type: 'tap-stats',
    generatedAt: Date.now(),
    scope: config.scope,
    traceReducer: config.traceReducer,
    groups: [...groups.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([label, group]) => {
        const summary: TapStatsGroupSummary = {
          label,
          location: group.location,
          sampleCount: group.sampleCount,
        }

        if (group.intValues.length > 0) {
          const sorted = [...group.intValues].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
          summary.ints = {
            count: group.intValues.length,
            min: formatBigInt(sorted[0]),
            p50: formatBigInt(percentile(sorted, 0.5)),
            p90: formatBigInt(percentile(sorted, 0.9)),
            p99: formatBigInt(percentile(sorted, 0.99)),
            max: formatBigInt(sorted[sorted.length - 1]),
            avg: formatAverage(group.intSum, group.intValues.length),
          }
        }

        const boolTotal = group.boolCounts.true + group.boolCounts.false
        if (boolTotal > 0) {
          summary.bools = {
            count: boolTotal,
            trueCount: group.boolCounts.true,
            falseCount: group.boolCounts.false,
            truePercentage: percentageValue(group.boolCounts.true, boolTotal),
            falsePercentage: percentageValue(group.boolCounts.false, boolTotal),
          }
        }

        const stringTotal = [...group.stringCounts.values()].reduce((sum, count) => sum + count, 0)
        if (stringTotal > 0) {
          summary.strings = summarizeCounts(group.stringCounts, stringTotal)
        }

        const otherTotal = [...group.otherCounts.values()].reduce((sum, count) => sum + count, 0)
        if (otherTotal > 0) {
          summary.structures = summarizeCounts(group.otherCounts, otherTotal)
        }

        return summary
      }),
  }
}

function emitTapStatsText(report: TapStatsReport, out: (text: string) => void) {
  for (const group of report.groups) {
    const prefix = `[TAP-STATS] ${group.label}${locationToString(group.location)}`

    if (group.ints) {
      out(
        `${prefix} | ints=${group.ints.count} | min=${group.ints.min} | p50=${group.ints.p50} | p90=${group.ints.p90} | p99=${group.ints.p99} | max=${group.ints.max} | avg=${group.ints.avg}\n`
      )
    }

    if (group.bools) {
      out(
        `${prefix} | bools=${group.bools.count} | true=${group.bools.trueCount} (${formatPercentage(
          group.bools.trueCount,
          group.bools.count
        )}) | false=${group.bools.falseCount} (${formatPercentage(group.bools.falseCount, group.bools.count)})\n`
      )
    }

    if (group.strings) {
      out(
        `${prefix} | values=${group.strings.count} | distinct=${group.strings.distinct} | ${formatFrequencySummary(
          new Map(group.strings.entries.map(entry => [entry.value, entry.count])),
          group.strings.count,
          key => JSON.stringify(key)
        )}\n`
      )
    }

    if (group.structures) {
      out(
        `${prefix} | structures=${group.structures.count} | distinct=${
          group.structures.distinct
        } | ${formatFrequencySummary(
          new Map(group.structures.entries.map(entry => [entry.value, entry.count])),
          group.structures.count,
          key => truncate(key)
        )}\n`
      )
    }
  }
}

function parseStatsListenerConfig(spec: string): Either<QuintError, StatsListenerConfig> {
  if (spec === 'stats') {
    return right({ scope: 'event' })
  }

  if (spec.startsWith('stats:json:')) {
    const path = spec.slice('stats:json:'.length)
    if (path.trim() === '') {
      return left(tapError('QNT528', 'Tap listener stats:json: requires a file path'))
    }
    return right({ scope: 'event', jsonPath: path })
  }

  if (spec.startsWith('stats:trace:')) {
    const suffix = spec.slice('stats:trace:'.length)
    const separator = ':json:'
    const separatorIndex = suffix.indexOf(separator)
    const reducer = (separatorIndex >= 0 ? suffix.slice(0, separatorIndex) : suffix).trim()
    const jsonPath = separatorIndex >= 0 ? suffix.slice(separatorIndex + separator.length) : undefined
    if (!['last', 'min', 'max', 'count', 'sum'].includes(reducer)) {
      return left(
        tapError(
          'QNT528',
          `Unsupported stats trace reducer '${reducer}'. Supported reducers are: last, min, max, count, sum`
        )
      )
    }
    if (jsonPath !== undefined && jsonPath.trim() === '') {
      return left(tapError('QNT528', `Tap listener ${spec} requires a file path after :json:`))
    }
    return right({
      scope: 'trace',
      traceReducer: reducer as TapTraceReducer,
      jsonPath,
    })
  }

  return left(
    tapError(
      'QNT528',
      `Unsupported tap listener '${spec}'. Supported listeners are: stdout, stats, stats:json:/absolute/or/relative/path.json, stats:trace:last|min|max|count|sum, stats:trace:<reducer>:json:/absolute/or/relative/path.json, jsonl:/absolute/or/relative/path.jsonl`
    )
  )
}

function createStatsTapListener(spec: string, out: (text: string) => void, config: StatsListenerConfig): TapListener {
  const groups = new Map<string, TapStatsGroup>()
  const traceGroups = new Map<string, TapTraceGroup>()
  let traceActive = false
  let explicitTraceLifecycle = false

  const flushTrace = () => {
    if (!traceActive) {
      return
    }

    for (const [label, traceGroup] of traceGroups.entries()) {
      switch (config.traceReducer) {
        case 'last':
          if (traceGroup.last !== undefined) {
            recordTapSample(groups, label, traceGroup.location, traceGroup.last)
          }
          break
        case 'count':
          recordTapSample(groups, label, traceGroup.location, itfInt(BigInt(traceGroup.count)))
          break
        case 'sum':
          if (traceGroup.intSum !== undefined) {
            recordTapSample(groups, label, traceGroup.location, itfInt(traceGroup.intSum))
          }
          break
        case 'min':
        case 'max':
          if (traceGroup.intValue !== undefined) {
            recordTapSample(groups, label, traceGroup.location, itfInt(traceGroup.intValue))
          }
          break
      }
    }

    traceGroups.clear()
    traceActive = false
  }

  const ensureTrace = () => {
    if (!traceActive) {
      traceGroups.clear()
      traceActive = true
    }
  }

  return {
    spec,
    onTap(event) {
      if (config.scope === 'event') {
        recordTapSample(groups, event.label, event.location, event.itfValue)
        return
      }

      ensureTrace()
      const traceGroup = traceGroups.get(event.label) ?? { location: event.location, count: 0 }
      if (!traceGroups.has(event.label)) {
        traceGroups.set(event.label, traceGroup)
      }
      if (!traceGroup.location && event.location) {
        traceGroup.location = event.location
      }

      traceGroup.count += 1
      switch (config.traceReducer) {
        case 'last':
          traceGroup.last = event.itfValue
          break
        case 'count':
          break
        case 'sum': {
          const sample = classifyTapValue(event.itfValue)
          if (sample.kind !== 'int') {
            return
          }

          traceGroup.intSum = (traceGroup.intSum ?? 0n) + sample.value
          break
        }
        case 'min':
        case 'max': {
          const sample = classifyTapValue(event.itfValue)
          if (sample.kind !== 'int') {
            return
          }

          if (traceGroup.intValue === undefined) {
            traceGroup.intValue = sample.value
          } else if (config.traceReducer === 'min') {
            traceGroup.intValue = traceGroup.intValue < sample.value ? traceGroup.intValue : sample.value
          } else {
            traceGroup.intValue = traceGroup.intValue > sample.value ? traceGroup.intValue : sample.value
          }
          break
        }
      }
    },
    onTraceStart() {
      if (config.scope !== 'trace') {
        return
      }
      if (!explicitTraceLifecycle && traceActive && traceGroups.size > 0) {
        flushTrace()
      }
      explicitTraceLifecycle = true
      traceGroups.clear()
      traceActive = true
    },
    onTraceEnd() {
      if (config.scope === 'trace') {
        flushTrace()
      }
    },
    close() {
      if (config.scope === 'trace' && !explicitTraceLifecycle && traceActive && traceGroups.size > 0) {
        flushTrace()
      }
      if (groups.size === 0) {
        return
      }

      const report = buildTapStatsReport(config, groups)
      if (config.jsonPath) {
        writeFileSync(config.jsonPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' })
      } else {
        emitTapStatsText(report, out)
      }
    },
  }
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
        appendFileSync(path, `${tapEventToJson(event)}\n`, { encoding: 'utf8' })
      },
    })
  }

  if (spec === 'stats' || spec.startsWith('stats:')) {
    const config = parseStatsListenerConfig(spec)
    if (config.isLeft()) {
      return left(config.value)
    }
    if (config.value.jsonPath) {
      try {
        writeFileSync(config.value.jsonPath, '', { encoding: 'utf8' })
      } catch (error) {
        return left(
          tapError(
            'QNT528',
            `Failed to initialize tap listener ${spec}: ${error instanceof Error ? error.message : String(error)}`
          )
        )
      }
    }
    return right(createStatsTapListener(spec, out, config.value))
  }

  return left(
    tapError(
      'QNT528',
      `Unsupported tap listener '${spec}'. Supported listeners are: stdout, stats, stats:json:/absolute/or/relative/path.json, stats:trace:last|min|max|count|sum, stats:trace:<reducer>:json:/absolute/or/relative/path.json, jsonl:/absolute/or/relative/path.jsonl`
    )
  )
}

export function normalizeTapListenerSpecs(value: unknown): string[] {
  if (value === undefined || value === null) {
    return []
  }
  if (Array.isArray(value)) {
    return value
      .flatMap(v => String(v).split(','))
      .map(v => v.trim())
      .filter(v => v !== '')
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

  addListener(listener: TapListener) {
    this.listeners.push(listener)
  }

  beginTrace() {
    this.withListeners(
      listener => listener.onTraceStart?.(),
      (listener, error) => {
        listener.disabled = true
        console.error(
          `[tap] listener ${listener.spec} failed and was disabled while starting a trace: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    )
  }

  endTrace() {
    this.withListeners(
      listener => listener.onTraceEnd?.(),
      (listener, error) => {
        listener.disabled = true
        console.error(
          `[tap] listener ${listener.spec} failed and was disabled while ending a trace: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    )
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
    this.withListeners(
      listener => listener.close?.(),
      (listener, error) =>
        console.error(
          `[tap] listener ${listener.spec} failed while closing: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
    )
  }

  setLocationResolver(resolveLocation: (reference: bigint) => Loc | undefined) {
    this.resolveLocation = resolveLocation
  }

  private emit(event: TapEvent) {
    this.withListeners(
      listener => listener.onTap(event),
      (listener, error) => {
        listener.disabled = true
        console.error(
          `[tap] listener ${listener.spec} failed and was disabled: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    )
  }

  private withListeners(
    action: (listener: TapListener) => void,
    onError?: (listener: TapListener, error: unknown) => void
  ) {
    for (const listener of this.listeners) {
      if (listener.disabled) {
        continue
      }
      try {
        action(listener)
      } catch (error) {
        onError?.(listener, error)
      }
    }
  }
}

function parseTapListenerOpTarget(spec: string): Either<QuintError, { moduleName: string; name: string }> {
  const separator = spec.includes('::') ? '::' : '.'
  const index = spec.lastIndexOf(separator)
  if (index <= 0 || index >= spec.length - separator.length) {
    return left(
      tapError(
        'QNT528',
        `Invalid tap listener operator '${spec}'. Use a qualified name like Module.listener or Module::listener`
      )
    )
  }

  const moduleName = spec.slice(0, index).trim()
  const name = spec.slice(index + separator.length).trim()
  if (moduleName === '' || name === '') {
    return left(
      tapError(
        'QNT528',
        `Invalid tap listener operator '${spec}'. Use a qualified name like Module.listener or Module::listener`
      )
    )
  }

  return right({ moduleName, name })
}

export function tapEventToJson(event: TapEvent): string {
  return JSON.stringify({
    type: 'tap',
    sequence: event.sequence,
    backend: event.backend,
    timestamp: event.timestamp,
    reference: event.reference?.toString(),
    location: event.location,
    label: event.label,
    value: event.itfValue,
  })
}

export function createTapOperatorListener(
  spec: string,
  resolver: NameResolver,
  foreignBindings: ForeignBindingRegistry
): Either<QuintError, TapListener> {
  const target = parseTapListenerOpTarget(spec)
  if (target.isLeft()) {
    return left(target.value)
  }

  const definition = findBoundDefinition(resolver, target.value.moduleName, target.value.name)
  if (definition.isLeft()) {
    return left({
      ...definition.value,
      code: 'QNT528',
      message: definition.value.message.replace(
        `Foreign binding target ${target.value.moduleName}.${target.value.name}`,
        `Tap listener operator ${target.value.moduleName}.${target.value.name}`
      ),
    })
  }

  if (definition.value.expr.kind !== 'lambda' || definition.value.expr.params.length !== 1) {
    return left(
      tapError(
        'QNT528',
        `Tap listener operator ${target.value.moduleName}.${target.value.name} must be declared as pure def listener(eventJson: str): bool`
      )
    )
  }

  const binding = foreignBindings.get(definition.value.id)
  if (!binding) {
    return left(
      tapError(
        'QNT528',
        `Tap listener operator ${target.value.moduleName}.${target.value.name} requires a foreign binding`
      )
    )
  }

  return right({
    spec: `op:${target.value.moduleName}.${target.value.name}`,
    onTap(event) {
      const result = binding.invoke([rv.mkStr(tapEventToJson(event))])
      if (result.isLeft()) {
        throw new Error(result.value.message)
      }
    },
  })
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
