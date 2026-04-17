import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'

import { Either, left, right } from '@sweet-monads/either'

import { QuintOpDef, isDeclarationOnly } from '../ir/quintIr'
import { QuintType } from '../ir/quintTypes'
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

export type RustForeignAbi = 'int' | 'bool' | 'str'

export interface RustForeignBindingSpec {
  id: bigint
  module: string
  name: string
  library: string
  symbol: string
  freeSymbol?: string
  args: RustForeignAbi[]
  result: RustForeignAbi
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
      __ffiModule?: {
        FFIType: Record<string, number>
        dlopen: (
          path: string,
          symbols: Record<string, { args: number[]; returns: number }>
        ) => {
          symbols: Record<string, (...args: unknown[]) => unknown>
          close?: () => void
        }
      }
    }
  | undefined {
  return (globalThis as typeof globalThis & { Bun?: any }).Bun
}

async function loadBunFfiModule(): Promise<
  Either<
    QuintError,
    {
      FFIType: Record<string, number>
      dlopen: (
        path: string,
        symbols: Record<string, { args: number[]; returns: number }>
      ) => {
        symbols: Record<string, (...args: unknown[]) => unknown>
        close?: () => void
      }
    }
  >
> {
  const bun = getBunRuntime()
  if (bun?.__ffiModule) {
    return right(bun.__ffiModule)
  }

  try {
    const loadBunFfi = new Function('return import("bun:ffi")') as () => Promise<{
      FFIType: Record<string, number>
      dlopen: (
        path: string,
        symbols: Record<string, { args: number[]; returns: number }>
      ) => {
        symbols: Record<string, (...args: unknown[]) => unknown>
        close?: () => void
      }
    }>
    return right(await loadBunFfi())
  } catch (error) {
    return left(
      foreignError(
        'QNT518',
        `Foreign FFI bindings require Bun's bun:ffi module: ${error instanceof Error ? error.message : String(error)}`
      )
    )
  }
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

function parseModuleResult(value: unknown): Either<QuintError, RuntimeValue> {
  if (value !== null && typeof value === 'object' && 'then' in value) {
    return left(foreignError('QNT525', 'Foreign module bindings must be synchronous'))
  }

  return itfValueToRuntimeValue(value)
}

const I64_MIN = -(1n << 63n)
const I64_MAX = (1n << 63n) - 1n

type FfiCodec = {
  ffiType: number
  decode(value: unknown): Either<QuintError, RuntimeValue>
  encode(value: RuntimeValue): Either<QuintError, unknown>
  returnsCString?: boolean
}

function buildNativeAbiType(type: QuintType, spec: FfiBindingSpec): Either<QuintError, RustForeignAbi> {
  switch (type.kind) {
    case 'int':
    case 'bool':
    case 'str':
      return right(type.kind)
    default:
      return left(
        foreignError(
          'QNT527',
          `FFI binding ${spec.module}.${spec.name} only supports primitive Quint types (int, bool, str) in the native ABI`
        )
      )
  }
}

function buildFfiCodec(
  type: QuintType,
  spec: FfiBindingSpec,
  ffiTypes: Record<string, number>
): Either<QuintError, FfiCodec> {
  switch (type.kind) {
    case 'int':
      return right({
        ffiType: ffiTypes.i64,
        encode(value: RuntimeValue): Either<QuintError, unknown> {
          try {
            const intValue = value.toInt()
            if (intValue < I64_MIN || intValue > I64_MAX) {
              return left(
                foreignError(
                  'QNT527',
                  `FFI binding ${spec.module}.${spec.name} only supports Quint ints within the native i64 range`
                )
              )
            }
            return right(intValue)
          } catch (error) {
            return left(
              foreignError(
                'QNT527',
                `FFI binding ${spec.module}.${spec.name} expected an int argument: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            )
          }
        },
        decode(value: unknown): Either<QuintError, RuntimeValue> {
          if (typeof value === 'bigint' || typeof value === 'number') {
            return right(rv.mkInt(BigInt(value)))
          }
          return left(
            foreignError('QNT523', `FFI binding ${spec.module}.${spec.name} returned a non-integer native value`)
          )
        },
      })

    case 'bool':
      return right({
        ffiType: ffiTypes.bool,
        encode(value: RuntimeValue): Either<QuintError, unknown> {
          try {
            return right(value.toBool())
          } catch (error) {
            return left(
              foreignError(
                'QNT527',
                `FFI binding ${spec.module}.${spec.name} expected a bool argument: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            )
          }
        },
        decode(value: unknown): Either<QuintError, RuntimeValue> {
          if (typeof value === 'boolean') {
            return right(rv.mkBool(value))
          }
          return left(
            foreignError('QNT523', `FFI binding ${spec.module}.${spec.name} returned a non-boolean native value`)
          )
        },
      })

    case 'str':
      return right({
        ffiType: ffiTypes.cstring,
        returnsCString: true,
        encode(value: RuntimeValue): Either<QuintError, unknown> {
          try {
            return right(Buffer.from(`${value.toStr()}\0`, 'utf8'))
          } catch (error) {
            return left(
              foreignError(
                'QNT527',
                `FFI binding ${spec.module}.${spec.name} expected a string argument: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            )
          }
        },
        decode(value: unknown): Either<QuintError, RuntimeValue> {
          const text =
            typeof value === 'string'
              ? value
              : value && typeof value === 'object' && 'toString' in value && typeof value.toString === 'function'
              ? value.toString()
              : undefined

          if (typeof text === 'string') {
            return right(rv.mkStr(text))
          }

          return left(
            foreignError('QNT523', `FFI binding ${spec.module}.${spec.name} returned a non-string native value`)
          )
        },
      })

    default:
      return left(
        foreignError(
          'QNT527',
          `FFI binding ${spec.module}.${spec.name} only supports primitive Quint types (int, bool, str) in the native ABI`
        )
      )
  }
}

function buildNativeAbiSignature(
  def: QuintOpDef,
  spec: FfiBindingSpec
): Either<QuintError, { args: RustForeignAbi[]; result: RustForeignAbi }> {
  if (!def.typeAnnotation) {
    return left(foreignError('QNT527', `FFI binding ${spec.module}.${spec.name} requires an explicit type annotation`))
  }

  const argTypes = def.typeAnnotation.kind === 'oper' ? def.typeAnnotation.args : []
  const resultType = def.typeAnnotation.kind === 'oper' ? def.typeAnnotation.res : def.typeAnnotation

  const args: RustForeignAbi[] = []
  for (const type of argTypes) {
    const abiType = buildNativeAbiType(type, spec)
    if (abiType.isLeft()) {
      return left(abiType.value)
    }
    args.push(abiType.value)
  }

  const result = buildNativeAbiType(resultType, spec)
  if (result.isLeft()) {
    return left(result.value)
  }

  if (spec.freeSymbol && result.value !== 'str') {
    return left(
      foreignError('QNT519', `FFI binding ${spec.module}.${spec.name} may only use freeSymbol with str results`)
    )
  }

  return right({ args, result: result.value })
}

function buildFfiSignature(
  def: QuintOpDef,
  spec: FfiBindingSpec,
  ffiTypes: Record<string, number>
): Either<QuintError, { args: FfiCodec[]; result: FfiCodec }> {
  const nativeSignature = buildNativeAbiSignature(def, spec)
  if (nativeSignature.isLeft()) {
    return left(nativeSignature.value)
  }

  const argTypes = def.typeAnnotation?.kind === 'oper' ? def.typeAnnotation.args : []
  const resultType = def.typeAnnotation?.kind === 'oper' ? def.typeAnnotation.res : def.typeAnnotation
  if (!resultType) {
    return left(foreignError('QNT527', `FFI binding ${spec.module}.${spec.name} requires an explicit type annotation`))
  }

  const args: FfiCodec[] = []
  for (const type of argTypes) {
    const codec = buildFfiCodec(type, spec, ffiTypes)
    if (codec.isLeft()) {
      return left(codec.value)
    }
    args.push(codec.value)
  }

  const result = buildFfiCodec(resultType, spec, ffiTypes)
  if (result.isLeft()) {
    return left(result.value)
  }

  return right({ args, result: result.value })
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

export function findBoundDefinition(resolver: NameResolver, moduleName: string, name: string): Either<QuintError, QuintOpDef> {
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

async function loadFfiBinding(
  spec: FfiBindingSpec,
  baseDir: string,
  def: QuintOpDef
): Promise<Either<QuintError, ForeignBinding>> {
  if (!getBunRuntime()) {
    return left(foreignError('QNT518', 'Foreign FFI bindings require running Quint under Bun'))
  }

  const ffiModule = await loadBunFfiModule()
  if (ffiModule.isLeft()) {
    return left(ffiModule.value)
  }

  try {
    const signature = buildFfiSignature(def, spec, ffiModule.value.FFIType)
    if (signature.isLeft()) {
      return left(signature.value)
    }

    const symbols = {
      [spec.symbol]: {
        args: signature.value.args.map(codec => codec.ffiType),
        returns: signature.value.result.ffiType,
      },
      ...(spec.freeSymbol
        ? { [spec.freeSymbol]: { args: [ffiModule.value.FFIType.ptr], returns: ffiModule.value.FFIType.void } }
        : {}),
    }
    const library = ffiModule.value.dlopen(resolve(baseDir, spec.library), symbols) as {
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
        const nativeArgs: unknown[] = []
        for (const [index, codec] of signature.value.args.entries()) {
          const encoded = codec.encode(args[index])
          if (encoded.isLeft()) {
            return left(encoded.value)
          }
          nativeArgs.push(encoded.value)
        }

        try {
          const result = callSymbol(...nativeArgs)
          const parsed = signature.value.result.decode(result)

          if (
            freeSymbol &&
            signature.value.result.returnsCString &&
            result &&
            typeof result === 'object' &&
            'ptr' in result
          ) {
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

async function loadBinding(
  spec: BindingSpec,
  baseDir: string,
  def: QuintOpDef
): Promise<Either<QuintError, ForeignBinding>> {
  switch (spec.kind) {
    case 'module':
      return loadModuleBinding(spec, baseDir)
    case 'ffi':
      return loadFfiBinding(spec, baseDir, def)
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

    const loaded = await loadBinding(spec, baseDir, def.value)
    if (loaded.isLeft()) {
      return left(loaded.value)
    }

    registry.set(def.value.id, loaded.value)
  }

  return right(registry)
}

export async function loadRustForeignBindings(
  configPath: string | undefined,
  resolver: NameResolver
): Promise<Either<QuintError, RustForeignBindingSpec[]>> {
  if (!configPath) {
    return right([])
  }

  const resolvedConfigPath = resolve(configPath)
  const config = readBindingConfig(resolvedConfigPath)
  if (config.isLeft()) {
    return left(config.value)
  }

  const bindings: RustForeignBindingSpec[] = []
  const seenIds = new Set<bigint>()
  const baseDir = dirname(resolvedConfigPath)

  for (const spec of config.value.bindings) {
    if (spec.kind !== 'ffi') {
      return left(
        foreignError(
          'QNT526',
          `Rust backend foreign bindings only support kind "ffi"; ${spec.module}.${spec.name} uses ${spec.kind}`
        )
      )
    }

    const def = findBoundDefinition(resolver, spec.module, spec.name)
    if (def.isLeft()) {
      return left(def.value)
    }

    if (seenIds.has(def.value.id)) {
      return left(foreignError('QNT519', `Duplicate foreign binding for ${spec.module}.${spec.name}`))
    }

    const signature = buildNativeAbiSignature(def.value, spec)
    if (signature.isLeft()) {
      return left(signature.value)
    }

    seenIds.add(def.value.id)
    bindings.push({
      id: def.value.id,
      module: spec.module,
      name: spec.name,
      library: resolve(baseDir, spec.library),
      symbol: spec.symbol,
      freeSymbol: spec.freeSymbol,
      args: signature.value.args,
      result: signature.value.result,
    })
  }

  return right(bindings)
}
