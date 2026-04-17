declare global {
  namespace NodeJS {
    interface ProcessEnv {
      QUINT_RETRY_NONDET_SMALLER_THAN?: string
    }
  }
}

declare module 'bun:ffi' {
  export const FFIType: Record<string, number>

  export const dlopen: (
    path: string,
    symbols: Record<string, { args: number[]; returns: number }>
  ) => {
    symbols: Record<string, (...args: unknown[]) => unknown>
    close?: () => void
  }
}

export {}
