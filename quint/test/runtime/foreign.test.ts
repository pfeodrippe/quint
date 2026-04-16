import { afterEach, describe, it } from 'mocha'
import { assert } from 'chai'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { quintErrorToString } from '../../src'
import { walkExpression } from '../../src/ir/IRVisitor'
import { newIdGenerator } from '../../src/idGenerator'
import { parse, parseExpressionOrDeclaration } from '../../src/parsing/quintParserFrontend'
import { fileSourceResolver } from '../../src/parsing/sourceResolver'
import { newRng } from '../../src/rng'
import { loadForeignBindings } from '../../src/runtime/foreign'
import { Evaluator } from '../../src/runtime/impl/evaluator'
import { newTraceRecorder } from '../../src/runtime/trace'

const fixturePath = join(__dirname, 'foreignFixtures', 'bindings.json')
const globalWithBun = globalThis as typeof globalThis & { Bun?: any }
const originalBun = globalWithBun.Bun
const tempDirs: string[] = []

function prepare(input: string, context: string) {
  const idGen = newIdGenerator()
  const mockLookupPath = fileSourceResolver(new Map()).lookupPath('/', './mock')
  const { resolver, sourceMap } = parse(idGen, '<test>', mockLookupPath, `module Math { ${context} }`)
  const parseResult = parseExpressionOrDeclaration(input, '<input>', idGen, sourceMap)

  if (parseResult.kind !== 'expr') {
    assert.fail(`Expected an expression, found ${parseResult.kind}`)
  }

  walkExpression(resolver, parseResult.expr)
  if (resolver.errors.length > 0) {
    assert.fail(`Resolver errors: ${resolver.errors.map(quintErrorToString).join(', ')}`)
  }

  return { resolver, expr: parseResult.expr }
}

function withMockBun(bun: any = {}) {
  globalWithBun.Bun = bun
}

function makeTempBindings(files: Record<string, string>, config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'quint-foreign-'))
  tempDirs.push(dir)

  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8')
  }

  const configPath = join(dir, 'bindings.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  return configPath
}

async function loadRegistry(input: string, context: string, configPath: string) {
  const { resolver, expr } = prepare(input, context)
  const registry = await loadForeignBindings(configPath, resolver)
  return { resolver, expr, registry }
}

afterEach(() => {
  globalWithBun.Bun = originalBun
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('foreign bindings', () => {
  it('rejects foreign bindings when Bun is unavailable', async () => {
    if (globalWithBun.Bun) {
      return
    }

    const { resolver } = prepare('1', 'pure def add1(x: int): int')
    const result = await loadForeignBindings(fixturePath, resolver)

    assert.isTrue(result.isLeft())
    if (result.isRight()) {
      assert.fail('Expected foreign bindings loading to fail without Bun')
    }
    assert.equal(result.value.code, 'QNT518')
  })

  it('loads module bindings and evaluates declaration-only defs and vals', async () => {
    withMockBun()

    const context = 'pure def add1(x: int): int\npure val answer: int'
    const add1 = await loadRegistry('add1(41)', context, fixturePath)
    assert.isTrue(add1.registry.isRight(), add1.registry.isLeft() ? add1.registry.value.message : undefined)
    if (add1.registry.isLeft()) {
      assert.fail(add1.registry.value.message)
    }

    const rng = newRng()
    const evaluator = new Evaluator(add1.resolver.table, newTraceRecorder(0, rng), rng, false, add1.registry.value)
    const result = evaluator.evaluate(add1.expr)

    assert.isTrue(result.isRight(), result.isLeft() ? result.value.message : undefined)
    assert.deepEqual(result.value, { id: 0n, kind: 'int', value: 42n })

    const answer = await loadRegistry('answer', context, fixturePath)
    assert.isTrue(answer.registry.isRight(), answer.registry.isLeft() ? answer.registry.value.message : undefined)
    if (answer.registry.isLeft()) {
      assert.fail(answer.registry.value.message)
    }

    const answerResult = new Evaluator(
      answer.resolver.table,
      newTraceRecorder(0, rng),
      rng,
      false,
      answer.registry.value
    ).evaluate(answer.expr)

    assert.isTrue(answerResult.isRight(), answerResult.isLeft() ? answerResult.value.message : undefined)
    assert.deepEqual(answerResult.value, { id: 0n, kind: 'int', value: 42n })
  })

  it('supports structured module return values', async () => {
    withMockBun()

    const configPath = makeTempBindings(
      {
        'module.cjs': `module.exports = { pair() { return { '#tup': [{ '#bigint': '1' }, { '#bigint': '2' }] } } }\n`,
      },
      {
        bindings: [{ kind: 'module', module: 'Math', name: 'pair', path: './module.cjs' }],
      }
    )
    const { resolver, expr, registry } = await loadRegistry('pair', 'pure val pair: (int, int)', configPath)

    assert.isTrue(registry.isRight(), registry.isLeft() ? registry.value.message : undefined)
    if (registry.isLeft()) {
      assert.fail(registry.value.message)
    }

    const rng = newRng()
    const result = new Evaluator(resolver.table, newTraceRecorder(0, rng), rng, false, registry.value).evaluate(expr)

    assert.isTrue(result.isRight(), result.isLeft() ? result.value.message : undefined)
    assert.deepEqual(result.value, {
      id: 0n,
      kind: 'app',
      opcode: 'Tup',
      args: [
        { id: 0n, kind: 'int', value: 1n },
        { id: 0n, kind: 'int', value: 2n },
      ],
    })
  })

  it('rejects duplicate bindings', async () => {
    withMockBun()

    const configPath = makeTempBindings(
      {
        'module.cjs': `module.exports = { add1(x) { return { '#bigint': (BigInt(x['#bigint']) + 1n).toString() } } }\n`,
      },
      {
        bindings: [
          { kind: 'module', module: 'Math', name: 'add1', path: './module.cjs' },
          { kind: 'module', module: 'Math', name: 'add1', path: './module.cjs' },
        ],
      }
    )
    const { registry } = await loadRegistry('add1(1)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isLeft())
    if (registry.isRight()) {
      assert.fail('Expected duplicate bindings to fail')
    }
    assert.equal(registry.value.code, 'QNT519')
  })

  it('rejects bindings to operators with bodies', async () => {
    withMockBun()

    const { registry } = await loadRegistry('add1(1)', 'pure def add1(x: int): int = x + 1', fixturePath)

    assert.isTrue(registry.isLeft())
    if (registry.isRight()) {
      assert.fail('Expected a bodyful operator to be rejected')
    }
    assert.equal(registry.value.code, 'QNT521')
  })

  it('rejects bindings to unsupported qualifiers', async () => {
    withMockBun()

    const { registry } = await loadRegistry('add1(1)', 'def add1(x: int): int', fixturePath)

    assert.isTrue(registry.isLeft())
    if (registry.isRight()) {
      assert.fail('Expected a non-pure declaration to be rejected')
    }
    assert.equal(registry.value.code, 'QNT521')
  })

  it('rejects malformed binding configs', async () => {
    withMockBun()

    const configPath = makeTempBindings({}, { nope: [] })
    const { registry } = await loadRegistry('add1(1)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isLeft())
    if (registry.isRight()) {
      assert.fail('Expected a malformed config to fail')
    }
    assert.equal(registry.value.code, 'QNT519')
  })

  it('reports missing exports in module bindings', async () => {
    withMockBun()

    const configPath = makeTempBindings(
      {
        'module.cjs': `module.exports = { ok() { return { '#bigint': '1' } } }\n`,
      },
      {
        bindings: [{ kind: 'module', module: 'Math', name: 'add1', path: './module.cjs', export: 'missing' }],
      }
    )
    const { registry } = await loadRegistry('add1(1)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isLeft())
    if (registry.isRight()) {
      assert.fail('Expected a missing export to fail')
    }
    assert.equal(registry.value.code, 'QNT520')
  })

  it('rejects asynchronous module bindings at invocation time', async () => {
    withMockBun()

    const configPath = makeTempBindings(
      {
        'module.cjs': `module.exports = { async add1() { return { '#bigint': '42' } } }\n`,
      },
      {
        bindings: [{ kind: 'module', module: 'Math', name: 'add1', path: './module.cjs' }],
      }
    )
    const { resolver, expr, registry } = await loadRegistry('add1(1)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isRight(), registry.isLeft() ? registry.value.message : undefined)
    if (registry.isLeft()) {
      assert.fail(registry.value.message)
    }

    const rng = newRng()
    const result = new Evaluator(resolver.table, newTraceRecorder(0, rng), rng, false, registry.value).evaluate(expr)

    assert.isTrue(result.isLeft())
    if (result.isRight()) {
      assert.fail('Expected async foreign binding to fail')
    }
    assert.equal(result.value.code, 'QNT525')
  })

  it('fails when a declaration-only operator is called without a binding', () => {
    const { resolver, expr } = prepare('add1(1)', 'pure def add1(x: int): int')
    const rng = newRng()
    const result = new Evaluator(resolver.table, newTraceRecorder(0, rng), rng).evaluate(expr)

    assert.isTrue(result.isLeft())
    if (result.isRight()) {
      assert.fail('Expected missing binding to fail')
    }
    assert.equal(result.value.code, 'QNT524')
  })

  it('invokes ffi bindings through Bun.ffi', async () => {
    withMockBun({
      CString: 'cstring',
      ffi: ({ symbols }: { symbols: Record<string, unknown> }) => ({
        symbols: Object.fromEntries(
          Object.keys(symbols).map(name => [
            name,
            (payload: string) => {
              if (name === 'free_result') {
                return undefined
              }
              const args = JSON.parse(payload)
              return JSON.stringify({ '#bigint': (BigInt(args[0]['#bigint']) + 1n).toString() })
            },
          ])
        ),
      }),
    })

    const configPath = makeTempBindings(
      {},
      {
        bindings: [
          {
            kind: 'ffi',
            module: 'Math',
            name: 'add1',
            library: './libforeign.dylib',
            symbol: 'add1_host',
            freeSymbol: 'free_result',
          },
        ],
      }
    )
    const { resolver, expr, registry } = await loadRegistry('add1(41)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isRight(), registry.isLeft() ? registry.value.message : undefined)
    if (registry.isLeft()) {
      assert.fail(registry.value.message)
    }

    const rng = newRng()
    const result = new Evaluator(resolver.table, newTraceRecorder(0, rng), rng, false, registry.value).evaluate(expr)

    assert.isTrue(result.isRight(), result.isLeft() ? result.value.message : undefined)
    assert.deepEqual(result.value, { id: 0n, kind: 'int', value: 42n })
  })

  it('reports missing ffi symbols', async () => {
    withMockBun({
      CString: 'cstring',
      ffi: () => ({ symbols: {} }),
    })

    const configPath = makeTempBindings(
      {},
      {
        bindings: [{ kind: 'ffi', module: 'Math', name: 'add1', library: './libforeign.dylib', symbol: 'missing' }],
      }
    )
    const { registry } = await loadRegistry('add1(1)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isLeft())
    if (registry.isRight()) {
      assert.fail('Expected missing ffi symbol to fail')
    }
    assert.equal(registry.value.code, 'QNT520')
  })

  it('reports invalid ffi results', async () => {
    withMockBun({
      CString: 'cstring',
      ffi: ({ symbols }: { symbols: Record<string, unknown> }) => ({
        symbols: Object.fromEntries(Object.keys(symbols).map(name => [name, () => '{not-json'])),
      }),
    })

    const configPath = makeTempBindings(
      {},
      {
        bindings: [{ kind: 'ffi', module: 'Math', name: 'add1', library: './libforeign.dylib', symbol: 'add1_host' }],
      }
    )
    const { resolver, expr, registry } = await loadRegistry('add1(1)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isRight(), registry.isLeft() ? registry.value.message : undefined)
    if (registry.isLeft()) {
      assert.fail(registry.value.message)
    }

    const rng = newRng()
    const result = new Evaluator(resolver.table, newTraceRecorder(0, rng), rng, false, registry.value).evaluate(expr)

    assert.isTrue(result.isLeft())
    if (result.isRight()) {
      assert.fail('Expected invalid ffi JSON to fail')
    }
    assert.equal(result.value.code, 'QNT523')
  })

  it('invokes wasm bindings through the wasm adapter', async () => {
    withMockBun()

    const configPath = makeTempBindings(
      {
        'module.cjs': `
          module.exports = async function () {
            return {
              add1(x) {
                return { '#bigint': (BigInt(x['#bigint']) + 1n).toString() }
              },
            }
          }
        `,
      },
      {
        bindings: [{ kind: 'wasm', module: 'Math', name: 'add1', path: './module.cjs' }],
      }
    )
    const { resolver, expr, registry } = await loadRegistry('add1(41)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isRight(), registry.isLeft() ? registry.value.message : undefined)
    if (registry.isLeft()) {
      assert.fail(registry.value.message)
    }

    const rng = newRng()
    const result = new Evaluator(resolver.table, newTraceRecorder(0, rng), rng, false, registry.value).evaluate(expr)

    assert.isTrue(result.isRight(), result.isLeft() ? result.value.message : undefined)
    assert.deepEqual(result.value, { id: 0n, kind: 'int', value: 42n })
  })

  it('reports missing wasm exports', async () => {
    withMockBun()

    const configPath = makeTempBindings(
      {
        'module.cjs': `module.exports = async function () { return {} }\n`,
      },
      {
        bindings: [{ kind: 'wasm', module: 'Math', name: 'add1', path: './module.cjs' }],
      }
    )
    const { registry } = await loadRegistry('add1(1)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isLeft())
    if (registry.isRight()) {
      assert.fail('Expected missing wasm export to fail')
    }
    assert.equal(registry.value.code, 'QNT520')
  })

  it('reports invalid wasm results', async () => {
    withMockBun()

    const configPath = makeTempBindings(
      {
        'module.cjs': `
          module.exports = async function () {
            return {
              add1() {
                return undefined
              },
            }
          }
        `,
      },
      {
        bindings: [{ kind: 'wasm', module: 'Math', name: 'add1', path: './module.cjs' }],
      }
    )
    const { resolver, expr, registry } = await loadRegistry('add1(1)', 'pure def add1(x: int): int', configPath)

    assert.isTrue(registry.isRight(), registry.isLeft() ? registry.value.message : undefined)
    if (registry.isLeft()) {
      assert.fail(registry.value.message)
    }

    const rng = newRng()
    const result = new Evaluator(resolver.table, newTraceRecorder(0, rng), rng, false, registry.value).evaluate(expr)

    assert.isTrue(result.isLeft())
    if (result.isRight()) {
      assert.fail('Expected invalid wasm return value to fail')
    }
    assert.equal(result.value.code, 'QNT523')
  })
})
