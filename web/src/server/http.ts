import type { z } from 'zod'
import { WaitQuery } from '@valet/protocol'
import type { ApiErrorBody, ApiErrorCode } from '@valet/protocol'
import { LIMITS } from './limits'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly hint?: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export function toErrorResponse(error: unknown) {
  const e =
    error instanceof ApiError
      ? error
      : new ApiError(500, 'server_error', 'Something went wrong on the relay.', 'The fault is not in your request. Retry once after a few seconds.')
  // unknown errors are logged by name only, so no request content reaches the logs
  if (!(error instanceof ApiError)) console.error(`unhandled: ${error instanceof Error ? `${error.name}: ${error.message}` : 'non-error thrown'}`)
  const body: ApiErrorBody = { error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } }
  return json(body, e.status, e.headers)
}

export type Params = Record<string, string>

export function handle(fn: (request: Request, params: Params) => Promise<Response>) {
  return (ctx: { request: Request; params: Params }) => fn(ctx.request, ctx.params).catch(toErrorResponse)
}

const tooLarge = (max: number) => new ApiError(413, 'too_large', `A request body may be up to ${max} bytes.`, 'Nothing was done.')

export async function readBody(request: Request, max: number = LIMITS.bodyBytes) {
  if (Number(request.headers.get('content-length')) > max) throw tooLarge(max)
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw tooLarge(max)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>, max?: number) {
  let body: unknown
  try {
    body = JSON.parse(await readBody(request, max))
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'invalid_request', 'Body must be JSON.', 'Build the body with jq rather than by hand.')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
    throw new ApiError(400, 'invalid_request', 'The request body is not valid.', fields)
  }
  return parsed.data
}

export function bearer(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  const token = match?.[1]
  return token && token !== 'null' && token !== 'undefined' ? token : undefined
}

export function readWait(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = WaitQuery.safeParse(params)
  if (!parsed.success)
    throw new ApiError(400, 'invalid_request', 'The query is not valid.', 'wait is 0 to 50 seconds; after is a sequence number from last_seq.')
  return parsed.data
}

export const notFound = (message: string, hint?: string) => new ApiError(404, 'not_found', message, hint)

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export function refuse(...allowed: (typeof METHODS)[number][]) {
  const reply = ({ request }: { request: Request }) =>
    toErrorResponse(
      new ApiError(405, 'method_not_allowed', `${new URL(request.url).pathname} does not take ${request.method}.`, `It takes ${allowed.join(', ')}.`, {
        Allow: allowed.join(', '),
      }),
    )
  return Object.fromEntries(METHODS.filter((m) => !allowed.includes(m)).map((m) => [m, reply]))
}
