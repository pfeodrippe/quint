import { describe, it } from 'mocha'
import { expect } from 'chai'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import chalk from 'chalk'

import { createTapManager } from '../src/tap'

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
})
