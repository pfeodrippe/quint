import { describe, it } from 'mocha'
import { expect } from 'chai'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import chalk from 'chalk'
import { right } from '@sweet-monads/either'

import { NameResolver } from '../src/names/resolver'
import { createTapManager, createTapOperatorListener } from '../src/tap'
import { rv, RuntimeValue } from '../src/runtime/impl/runtimeValue'

describe('tap manager', () => {
  it('writes q::tap events to a jsonl listener', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quint-tap-test-'))
    const path = join(dir, 'taps.jsonl')

    try {
      const managerResult = createTapManager([`jsonl:${path}`], () => {})
      if (managerResult.isLeft()) {
        throw new Error(managerResult.value.message)
      }
      const manager = managerResult.value
      manager.emitQuint(11n, 'answer', { id: 1n, kind: 'int', value: 5n }, 'typescript')
      manager.close()

      const lines = readFileSync(path, 'utf8').trim().split('\n')
      expect(lines).to.have.length(1)
      expect(JSON.parse(lines[0])).to.deep.include({
        type: 'tap',
        backend: 'typescript',
        label: 'answer',
        value: { '#bigint': '5' },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes q::tap events to stdout listeners', () => {
    const previousLevel = chalk.level
    try {
      chalk.level = 0
      let output = ''
      const managerResult = createTapManager(['stdout'], text => {
        output += text
      })
      if (managerResult.isLeft()) {
        throw new Error(managerResult.value.message)
      }
      const manager = managerResult.value

      manager.emitQuint(12n, 'value', { id: 1n, kind: 'int', value: 7n }, 'typescript')
      manager.close()

      expect(output).to.equal('[TAP] value 7\n')
    } finally {
      chalk.level = previousLevel
    }
  })

  it('invokes direct tap listener operators without a file middleman', () => {
    const resolver = new NameResolver()
    const listenerDef = {
      id: 91n,
      kind: 'def' as const,
      name: 'tapPortalListener',
      qualifier: 'puredef' as const,
      declarationOnly: true,
      expr: {
        id: 92n,
        kind: 'lambda' as const,
        qualifier: 'puredef' as const,
        params: [{ id: 93n, name: 'eventJson' }],
        expr: { id: 94n, kind: 'bool' as const, value: true },
      },
    }
    resolver.collector.definitionsByModule.set('bankTapDebug', new Map([['tapPortalListener', [listenerDef]]]))

    const calls: string[] = []
    const bindingRegistry = new Map([
      [
        91n,
        {
          kind: 'module' as const,
          invoke(args: RuntimeValue[]) {
            calls.push(args[0].toStr())
            return right(rv.mkBool(true))
          },
        },
      ],
    ])

    const listener = createTapOperatorListener('bankTapDebug.tapPortalListener', resolver, bindingRegistry)
    if (listener.isLeft()) {
      throw new Error(listener.value.message)
    }

    const managerResult = createTapManager(
      [],
      () => {},
      reference => ({
        source: 'spec.qnt',
        start: { line: 10, col: 2, index: 0 },
        end: { line: 10, col: 12, index: 10 },
      })
    )
    if (managerResult.isLeft()) {
      throw new Error(managerResult.value.message)
    }

    const manager = managerResult.value
    manager.addListener(listener.value)
    manager.emitQuint(13n, 'bank snapshot', { id: 1n, kind: 'int', value: 9n }, 'typescript')

    expect(calls).to.have.length(1)
    expect(JSON.parse(calls[0])).to.deep.include({
      type: 'tap',
      backend: 'typescript',
      label: 'bank snapshot',
      reference: '13',
      value: { '#bigint': '9' },
    })
    expect(JSON.parse(calls[0]).location.source).to.equal('spec.qnt')
  })

  it('summarizes numeric tap statistics by label', () => {
    let output = ''
    const managerResult = createTapManager(['stats'], text => {
      output += text
    })
    if (managerResult.isLeft()) {
      throw new Error(managerResult.value.message)
    }

    const manager = managerResult.value
    manager.emitQuint(21n, 'decision steps', { id: 1n, kind: 'int', value: 1n }, 'typescript')
    manager.emitQuint(21n, 'decision steps', { id: 2n, kind: 'int', value: 3n }, 'typescript')
    manager.emitQuint(21n, 'decision steps', { id: 3n, kind: 'int', value: 7n }, 'typescript')
    manager.close()

    expect(output).to.contain('[TAP-STATS] decision steps')
    expect(output).to.contain('ints=3')
    expect(output).to.contain('min=1')
    expect(output).to.contain('p50=3')
    expect(output).to.contain('p90=7')
    expect(output).to.contain('p99=7')
    expect(output).to.contain('max=7')
    expect(output).to.contain('avg=3.67')
  })

  it('summarizes categorical and boolean tap statistics by label', () => {
    let output = ''
    const managerResult = createTapManager(['stats'], text => {
      output += text
    })
    if (managerResult.isLeft()) {
      throw new Error(managerResult.value.message)
    }

    const manager = managerResult.value
    manager.emitQuint(undefined, 'decision outcome', { id: 1n, kind: 'str', value: 'commit' }, 'typescript')
    manager.emitQuint(undefined, 'decision outcome', { id: 2n, kind: 'str', value: 'abort' }, 'typescript')
    manager.emitQuint(undefined, 'decision outcome', { id: 3n, kind: 'str', value: 'commit' }, 'typescript')
    manager.emitQuint(undefined, 'invariant held', { id: 4n, kind: 'bool', value: true }, 'typescript')
    manager.emitQuint(undefined, 'invariant held', { id: 5n, kind: 'bool', value: false }, 'typescript')
    manager.close()

    expect(output).to.contain('[TAP-STATS] decision outcome')
    expect(output).to.contain('values=3')
    expect(output).to.contain('"commit"=2 (66.67%)')
    expect(output).to.contain('"abort"=1 (33.33%)')
    expect(output).to.contain('[TAP-STATS] invariant held')
    expect(output).to.contain('bools=2')
    expect(output).to.contain('true=1 (50.00%)')
    expect(output).to.contain('false=1 (50.00%)')
  })

  it('writes machine-readable stats summaries to json files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quint-tap-stats-json-'))
    const path = join(dir, 'stats.json')

    try {
      const managerResult = createTapManager([`stats:json:${path}`], () => {})
      if (managerResult.isLeft()) {
        throw new Error(managerResult.value.message)
      }

      const manager = managerResult.value
      manager.emitQuint(31n, 'decision steps', { id: 1n, kind: 'int', value: 1n }, 'typescript')
      manager.emitQuint(31n, 'decision steps', { id: 2n, kind: 'int', value: 5n }, 'typescript')
      manager.emitQuint(undefined, 'decision outcome', { id: 3n, kind: 'str', value: 'commit' }, 'typescript')
      manager.emitQuint(undefined, 'decision outcome', { id: 4n, kind: 'str', value: 'abort' }, 'typescript')
      manager.close()

      const json = JSON.parse(readFileSync(path, 'utf8'))
      expect(json.type).to.equal('tap-stats')
      expect(json.scope).to.equal('event')
      expect(json.groups).to.have.length(2)
      const stepsGroup = json.groups.find((group: any) => group.label === 'decision steps')
      const outcomeGroup = json.groups.find((group: any) => group.label === 'decision outcome')
      expect(stepsGroup).to.deep.include({
        label: 'decision steps',
        sampleCount: 2,
      })
      expect(stepsGroup.ints).to.deep.include({
        count: 2,
        min: '1',
        p50: '1',
        p90: '5',
        p99: '5',
        max: '5',
        avg: '3.00',
      })
      expect(outcomeGroup.strings).to.deep.include({
        count: 2,
        distinct: 2,
      })
      expect(outcomeGroup.strings.entries).to.deep.equal([
        { value: 'abort', count: 1, percentage: 50 },
        { value: 'commit', count: 1, percentage: 50 },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('summarizes structured tap values in stats output', () => {
    let output = ''
    const managerResult = createTapManager(['stats'], text => {
      output += text
    })
    if (managerResult.isLeft()) {
      throw new Error(managerResult.value.message)
    }

    const manager = managerResult.value
    manager.emitQuint(
      undefined,
      'snapshot',
      {
        id: 6n,
        kind: 'app',
        opcode: 'Rec',
        args: [
          { id: 7n, kind: 'str', value: 'x' },
          { id: 8n, kind: 'int', value: 1n },
        ],
      },
      'typescript'
    )
    manager.emitQuint(
      undefined,
      'snapshot',
      {
        id: 9n,
        kind: 'app',
        opcode: 'Rec',
        args: [
          { id: 10n, kind: 'str', value: 'x' },
          { id: 11n, kind: 'int', value: 1n },
        ],
      },
      'typescript'
    )
    manager.close()

    expect(output).to.contain('[TAP-STATS] snapshot')
    expect(output).to.contain('structures=2')
    expect(output).to.contain('distinct=1')
    expect(output).to.contain('{"x":{"#bigint":"1"}}=2 (100.00%)')
  })

  it('reduces repeated taps per trace with the last reducer', () => {
    let output = ''
    const managerResult = createTapManager(['stats:trace:last'], text => {
      output += text
    })
    if (managerResult.isLeft()) {
      throw new Error(managerResult.value.message)
    }

    const manager = managerResult.value
    manager.beginTrace()
    manager.emitQuint(undefined, 'position', { id: 12n, kind: 'int', value: 1n }, 'typescript')
    manager.emitQuint(undefined, 'position', { id: 13n, kind: 'int', value: 2n }, 'typescript')
    manager.endTrace()
    manager.beginTrace()
    manager.emitQuint(undefined, 'position', { id: 14n, kind: 'int', value: -1n }, 'typescript')
    manager.emitQuint(undefined, 'position', { id: 15n, kind: 'int', value: 4n }, 'typescript')
    manager.endTrace()
    manager.close()

    expect(output).to.contain('[TAP-STATS] position')
    expect(output).to.contain('ints=2')
    expect(output).to.contain('min=2')
    expect(output).to.contain('p50=2')
    expect(output).to.contain('p90=4')
    expect(output).to.contain('max=4')
    expect(output).to.contain('avg=3.00')
  })

  it('counts tap occurrences per trace with the count reducer', () => {
    let output = ''
    const managerResult = createTapManager(['stats:trace:count'], text => {
      output += text
    })
    if (managerResult.isLeft()) {
      throw new Error(managerResult.value.message)
    }

    const manager = managerResult.value
    manager.beginTrace()
    manager.emitQuint(undefined, 'position', { id: 16n, kind: 'int', value: 1n }, 'typescript')
    manager.emitQuint(undefined, 'position', { id: 17n, kind: 'int', value: 2n }, 'typescript')
    manager.endTrace()
    manager.beginTrace()
    manager.emitQuint(undefined, 'position', { id: 18n, kind: 'int', value: 3n }, 'typescript')
    manager.endTrace()
    manager.close()

    expect(output).to.contain('[TAP-STATS] position')
    expect(output).to.contain('ints=2')
    expect(output).to.contain('min=1')
    expect(output).to.contain('p50=1')
    expect(output).to.contain('p90=2')
    expect(output).to.contain('max=2')
    expect(output).to.contain('avg=1.50')
  })

  it('sums integer tap values per trace with the sum reducer', () => {
    let output = ''
    const managerResult = createTapManager(['stats:trace:sum'], text => {
      output += text
    })
    if (managerResult.isLeft()) {
      throw new Error(managerResult.value.message)
    }

    const manager = managerResult.value
    manager.beginTrace()
    manager.emitQuint(undefined, 'work', { id: 22n, kind: 'int', value: 1n }, 'typescript')
    manager.emitQuint(undefined, 'work', { id: 23n, kind: 'int', value: 2n }, 'typescript')
    manager.endTrace()
    manager.beginTrace()
    manager.emitQuint(undefined, 'work', { id: 24n, kind: 'int', value: 4n }, 'typescript')
    manager.emitQuint(undefined, 'work', { id: 25n, kind: 'int', value: 5n }, 'typescript')
    manager.endTrace()
    manager.close()

    expect(output).to.contain('[TAP-STATS] work')
    expect(output).to.contain('ints=2')
    expect(output).to.contain('min=3')
    expect(output).to.contain('p50=3')
    expect(output).to.contain('p90=9')
    expect(output).to.contain('max=9')
    expect(output).to.contain('avg=6.00')
  })

  it('writes machine-readable per-trace stats summaries to json files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quint-tap-trace-stats-json-'))
    const path = join(dir, 'trace-stats.json')

    try {
      const managerResult = createTapManager([`stats:trace:max:json:${path}`], () => {})
      if (managerResult.isLeft()) {
        throw new Error(managerResult.value.message)
      }

      const manager = managerResult.value
      manager.beginTrace()
      manager.emitQuint(undefined, 'position', { id: 19n, kind: 'int', value: 1n }, 'typescript')
      manager.emitQuint(undefined, 'position', { id: 20n, kind: 'int', value: 3n }, 'typescript')
      manager.endTrace()
      manager.beginTrace()
      manager.emitQuint(undefined, 'position', { id: 21n, kind: 'int', value: 2n }, 'typescript')
      manager.endTrace()
      manager.close()

      const json = JSON.parse(readFileSync(path, 'utf8'))
      expect(json.type).to.equal('tap-stats')
      expect(json.scope).to.equal('trace')
      expect(json.traceReducer).to.equal('max')
      expect(json.groups).to.have.length(1)
      expect(json.groups[0]).to.deep.include({
        label: 'position',
        sampleCount: 2,
      })
      expect(json.groups[0].ints).to.deep.include({
        count: 2,
        min: '2',
        p50: '2',
        p90: '3',
        p99: '3',
        max: '3',
        avg: '2.50',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
