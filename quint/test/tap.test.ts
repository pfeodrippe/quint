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

    const managerResult = createTapManager([], () => {}, reference => ({
      source: 'spec.qnt',
      start: { line: 10, col: 2, index: 0 },
      end: { line: 10, col: 12, index: 10 },
    }))
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
})
