import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'

import { Either, left, right } from '@sweet-monads/either'

import { QuintOpDef, isDeclarationOnly } from '../ir/quintIr'
import { zerog } from '../idGenerator'
import { ItfValue, ofItfValue, toItfValue } from '../itf'
import { NameResolver } from '../names/resolver'
import { QuintError } from '../quintError'
import { RuntimeValue, rv } from './impl/runtimeValue'

type BindingKind = 'module' | 'ffi' | 'wasm'

interface BindingBase {
  kind: BindingKind
  module: string
  name: string
}

interface ModuleBindingSpec extends BindingBase {
  kind: 'module'
  path: string
  export?: string
}

interface FfiBindingSpec extends BindingBase {
  kind: 'ffi'
  library: string
  symbol: string
  freeSymbol?: string
}

interface WasmBindingSpec extends BindingBase {
  kind: 'wasm'
  path: string
  export?: string
}

type BindingSpec = ModuleBindingSpec | FfiBindingSpec | WasmBindingSpec

interface BindingConfigFile {
  bindings: BindingSpec[]
}

export interface ForeignBinding {
  kind: BindingKind
  invoke(args: RuntimeValue[]): Either<QuintError, RuntimeValue>
}

export type ForeignBindingRegistry = Map<bigint, ForeignBinding>

function foreignError(code: QuintError['code'], message: string): QuintError {
  return { code, message }
}

function getBunRuntime():
  | {
      ffi?: (args: unknown) => { symbols: Record<string, (...args: unknown[]) => unknown> }
      CString?: unknown
    }
  | undefined {
  return (globalThis as typeof globalThis & { Bun?: any }).Bun
}

function runtimeValueToItfValue(value: RuntimeValue): Either<QuintError, ItfValue> {
  return toItfValue(value.toQuintEx(zerog)).mapLeft(message => foreignError('QNT523', message))
}

function itfValueToRuntimeValue(value: unknown): Either<QuintError, RuntimeValue> {
  try {
    return right(rv.fromQuintEx(ofItfValue(value as ItfValue, zerog.nextId)))
  } catch (error) {
    return left(
      foreignError(
        'QNT523',
        `Foreign binding returned an invalid value: ${error instanceof Error ? error.message : String(error)}`
      )
    )
  }
}

function runtimeArgsToJson(args: RuntimeValue[]): Either<QuintError, string> {
  const values: ItfValue[] = []
  for (const arg of args) {
    const converted = runtimeValueToItfValue(arg)
    if (converted.isLeft()) {
      return left(converted.value)
    }
    values.push(converted.value)
  }
  return right(JSON.stringify(values))
}

function parseJsonResult(raw: string): Either<QuintError, RuntimeValue> {
  try {
    return itfValueToRuntimeValue(JSON.parse(raw))
  } catch (error) {
    return left(
      foreignError(
        'QNT523',
        `Foreign binding returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    )
  }
}

function parseModuleResult(value: unknown): Either<QuintError, RuntimeValue> {
  if (value !== null && typeof value === 'object' && 'then' in value) {
    return left(foreignError('QNT525', 'Foreign module bindings must be synchronous'))
  }

  return itfValueToRuntimeValue(value)
}

function parseBindingSpec(raw: unknown): Either<QuintError, BindingSpec> {
  if (raw === null || typeof raw !== 'object') {
    return left(foreignError('QNT519', 'Every foreign binding entry must be an object'))
  }

  const candidate = raw as Record<string, unknown>
  const module = candidate.module
  const name = candidate.name
  const kind = candidate.kind

  if (typeof module !== 'string' || typeof name !== 'string' || typeof kind !== 'string') {
    return left(foreignError('QNT519', 'Foreign bindings require string fields: kind, module, and name'))
  }

  switch (kind) {
    case 'module': {
      if (typeof candidate.path !== 'string') {
        return left(foreignError('QNT519', `Module binding ${module}.${name} is missing a string path`))
      }
      if (candidate.export !== undefined && typeof candidate.export !== 'string') {
        return left(foreignError('QNT519', `Module binding ${module}.${name} has an invalid export name`))
      }
      return right({
        kind,
        module,
        name,
        path: candidate.path,
        export: candidate.export as string | undefined,
      })
    }

    case 'ffi': {
      if (typeof candidate.library !== 'string' || typeof candidate.symbol !== 'string') {
        return left(foreignError('QNT519', `FFI binding ${module}.${name} requires string library and symbol fields`))
      }
      if (candidate.freeSymbol !== undefined && typeof candidate.freeSymbol !== 'string') {
        return left(foreignError('QNT519', `FFI binding ${module}.${name} has an invalid freeSymbol`))
      }
      return right({
        kind,
        module,
        name,
        library: candidate.library,
        symbol: candidate.symbol,
        freeSymbol: candidate.freeSymbol as string | undefined,
      })
    }

    case 'wasm': {
      if (typeof candidate.path !== 'string') {
        return left(foreignError('QNT519', `Wasm binding ${module}.${name} is missing a string path`))
      }
      if (candidate.export !== undefined && typeof candidate.export !== 'string') {
        return left(foreignError('QNT519', `Wasm binding ${module}.${name} has an invalid export name`))
      }
      return right({
        kind,
        module,
        name,
        path: candidate.path,
        export: candidate.export as string | undefined,
      })
    }

    default:
      return left(foreignError('QNT519', `Unsupported foreign binding kind: ${kind}`))
  }
}

function readBindingConfig(configPath: string): Either<QuintError, BindingConfigFile> {
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as { bindings?: unknown }
    if (!Array.isArray(raw.bindings)) {
      return left(foreignError('QNT519', 'Foreign bindings config must contain a bindings array'))
    }

    const bindings: BindingSpec[] = []
    for (const binding of raw.bindings) {
      const parsed = parseBindingSpec(binding)
      if (parsed.isLeft()) {
        return left(parsed.value)
      }
      bindings.push(parsed.value)
    }

    return right({ bindings })
  } catch (error) {
    return left(
      foreignError(
        'QNT519',
        `Failed to read foreign bindings config ${configPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    )
  }
}

function findBoundDefinition(resolver: NameResolver, moduleName: string, name: string): Either<QuintError, QuintOpDef> {
  const candidates = Array.from(resolver.collector.definitionsByModule.get(moduleName)?.values() ?? []).flat()
  const found = candidates.find(def => def.kind === 'def' && def.name === name)

  if (!found || found.kind !== 'def') {
    return left(foreignError('QNT520', `Foreign binding target ${moduleName}.${name} was not found`))
  }

  if (!isDeclarationOnly(found)) {
    return left(
      foreignError('QNT521', `Foreign binding target ${moduleName}.${name} must be declared without a Quint body`)
    )
  }

  if (found.qualifier !== 'puredef' && found.qualifier !== 'pureval') {
    return left(foreignError('QNT521', `Foreign binding target ${moduleName}.${name} must be declared as pure def/val`))
  }

  return right(found)
}

async function loadModuleBinding(
  spec: ModuleBindingSpec,
  baseDir: string
): Promise<Either<QuintError, ForeignBinding>> {
  try {
    const modulePath = resolve(baseDir, spec.path)
    const namespace = await import(modulePath)
    const exportName = spec.export ?? spec.name
    const fn = namespace[exportName] ?? namespace.default?.[exportName]

    if (typeof fn !== 'function') {
      return left(
        foreignError('QNT520', `Module binding ${spec.module}.${spec.name} could not find export ${exportName}`)
      )
    }

    return right({
      kind: 'module',
      invoke(args: RuntimeValue[]): Either<QuintError, RuntimeValue> {
        const convertedArgs: ItfValue[] = []
        for (const arg of args) {
          const converted = runtimeValueToItfValue(arg)
          if (converted.isLeft()) {
            return left(converted.value)
          }
          convertedArgs.push(converted.value)
        }

        try {
          return parseModuleResult(fn(...convertedArgs))
        } catch (error) {
          return left(
            foreignError(
              'QNT522',
              `Module binding ${spec.module}.${spec.name} threw: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          )
        }
      },
    })
  } catch (error) {
    return left(
      foreignError(
        'QNT520',
        `Failed to load module binding ${spec.module}.${spec.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    )
  }
}

async function loadFfiBinding(spec: FfiBindingSpec, baseDir: string): Promise<Either<QuintError, ForeignBinding>> {
  const bun = getBunRuntime()
  if (!bun?.ffi) {
    return left(foreignError('QNT518', 'Foreign FFI bindings require running Quint under Bun'))
  }

  try {
    const symbols = {
      [spec.symbol]: { args: ['cstring'], returns: bun.CString ?? 'cstring' },
      ...(spec.freeSymbol ? { [spec.freeSymbol]: { args: ['ptr'], returns: 'void' } } : {}),
    }
    const library = bun.ffi({ path: resolve(baseDir, spec.library), symbols }) as {
      symbols: Record<string, (...args: unknown[]) => unknown>
    }
    const callSymbol = library.symbols[spec.symbol]
    const freeSymbol = spec.freeSymbol ? library.symbols[spec.freeSymbol] : undefined

    if (typeof callSymbol !== 'function') {
      return left(foreignError('QNT520', `FFI symbol ${spec.symbol} was not loaded for ${spec.module}.${spec.name}`))
    }

    return right({
      kind: 'ffi',
      invoke(args: RuntimeValue[]): Either<QuintError, RuntimeValue> {
        const payload = runtimeArgsToJson(args)
        if (payload.isLeft()) {
          return left(payload.value)
        }

        try {
          const result = callSymbol(payload.value) as { toString?: () => string; ptr?: unknown } | string
          const text = typeof result === 'string' ? result : result?.toString?.()
          if (typeof text !== 'string') {
            return left(
              foreignError('QNT523', `FFI binding ${spec.module}.${spec.name} did not return a C string result`)
            )
          }

          const parsed = parseJsonResult(text)

          if (freeSymbol && result && typeof result === 'object' && 'ptr' in result) {
            freeSymbol(result.ptr)
          }

          return parsed
        } catch (error) {
          return left(
            foreignError(
              'QNT522',
              `FFI binding ${spec.module}.${spec.name} failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          )
        }
      },
    })
  } catch (error) {
    return left(
      foreignError(
        'QNT520',
        `Failed to load FFI binding ${spec.module}.${spec.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    )
  }
}

async function loadWasmBinding(spec: WasmBindingSpec, baseDir: string): Promise<Either<QuintError, ForeignBinding>> {
  const bun = getBunRuntime()
  if (!bun) {
    return left(foreignError('QNT518', 'Foreign Wasm bindings require running Quint under Bun'))
  }

  try {
    const modulePath = resolve(baseDir, spec.path)
    const namespace = await import(modulePath)
    const exportsObject =
      typeof namespace.default === 'function' ? await namespace.default() : namespace.default ?? namespace
    const exportName = spec.export ?? spec.name
    const fn = exportsObject?.[exportName]

    if (typeof fn !== 'function') {
      return left(
        foreignError('QNT520', `Wasm binding ${spec.module}.${spec.name} could not find export ${exportName}`)
      )
    }

    return right({
      kind: 'wasm',
      invoke(args: RuntimeValue[]): Either<QuintError, RuntimeValue> {
        const convertedArgs: ItfValue[] = []
        for (const arg of args) {
          const converted = runtimeValueToItfValue(arg)
          if (converted.isLeft()) {
            return left(converted.value)
          }
          convertedArgs.push(converted.value)
        }

        try {
          return parseModuleResult(fn(...convertedArgs))
        } catch (error) {
          return left(
            foreignError(
              'QNT522',
              `Wasm binding ${spec.module}.${spec.name} failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          )
        }
      },
    })
  } catch (error) {
    return left(
      foreignError(
        'QNT520',
        `Failed to load Wasm binding ${spec.module}.${spec.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    )
  }
}

async function loadBinding(spec: BindingSpec, baseDir: string): Promise<Either<QuintError, ForeignBinding>> {
  switch (spec.kind) {
    case 'module':
      return loadModuleBinding(spec, baseDir)
    case 'ffi':
      return loadFfiBinding(spec, baseDir)
    case 'wasm':
      return loadWasmBinding(spec, baseDir)
  }
}

export async function loadForeignBindings(
  configPath: string | undefined,
  resolver: NameResolver
): Promise<Either<QuintError, ForeignBindingRegistry>> {
  if (!configPath) {
    return right(new Map())
  }

  if (!getBunRuntime()) {
    return left(foreignError('QNT518', 'Foreign bindings require running Quint under Bun'))
  }

  const resolvedConfigPath = resolve(configPath)
  const config = readBindingConfig(resolvedConfigPath)
  if (config.isLeft()) {
    return left(config.value)
  }

  const registry: ForeignBindingRegistry = new Map()
  const baseDir = dirname(resolvedConfigPath)

  for (const spec of config.value.bindings) {
    const def = findBoundDefinition(resolver, spec.module, spec.name)
    if (def.isLeft()) {
      return left(def.value)
    }

    if (registry.has(def.value.id)) {
      return left(foreignError('QNT519', `Duplicate foreign binding for ${spec.module}.${spec.name}`))
    }

    const loaded = await loadBinding(spec, baseDir)
    if (loaded.isLeft()) {
      return left(loaded.value)
    }

    registry.set(def.value.id, loaded.value)
  }

  return right(registry)
}
