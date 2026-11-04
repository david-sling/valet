import type { z } from 'zod'
import type { ApiErrorBody, ApiErrorCode } from '@valet/protocol'

const MAX_BODY_BYTES = 256 * 1024

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

export function handle(fn: (request: Request) => Promise<Response>) {
  return (ctx: { request: Request }) => fn(ctx.request).catch(toErrorResponse)
}

const tooLarge = () => new ApiError(413, 'too_large', `A request body may be up to ${MAX_BODY_BYTES} bytes.`, 'Nothing was done.')

async function readBody(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw tooLarge()
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>) {
  let body: unknown
  try {
    body = JSON.parse(await readBody(request))
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
