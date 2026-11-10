import { randomBytes } from 'node:crypto'

const BYTES = 32
export const HANDLE = /^[A-Za-z0-9_-]{43}$/

export const newHandle = () => randomBytes(BYTES).toString('base64url')

const text = (v: unknown) => (typeof v === 'string' && HANDLE.test(v) ? v : undefined)

export function handleOf(body: unknown): string | undefined {
  for (const message of [body].flat()) {
    const params = (message as { params?: { arguments?: Record<string, unknown> } } | null)?.params
    const given = text(params?.arguments?.session)
    if (given) return given
  }
  return undefined
}
