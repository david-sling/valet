import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { getConfig } from '../config'
import { ApiError, readBody } from '../http'
import { getRedis } from '../redis'
import { isClosed } from './binding'
import { callerOf } from './caller'
import { handleOf } from './handle'
import { isMcpSessionId, newMcpSessionId } from './session-id'
import { MCP_WAIT_S, buildServer, closeConnection } from './tools'
import type { Context } from './tools'

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }

function reply(status: number, message?: string, headers: Record<string, string> = {}) {
  const body = message ? JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }) : null
  return new Response(body, { status, headers: { ...HEADERS, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } })
}

const isInitialize = (body: unknown) => [body].flat().some((m) => (m as { method?: unknown } | null)?.method === 'initialize')

// The SDK runs stateless, a fresh server per request, so any instance can answer any call. The session lives in the
// Mcp-Session-Id this route mints at initialize and in the Redis binding start_session makes from it
export async function handleMcp(request: Request, { waitSeconds = MCP_WAIT_S }: { waitSeconds?: number } = {}) {
  // DNS-rebinding hygiene for browsers; authorisation comes only from the bound session
  const origin = request.headers.get('origin')
  if (origin && origin !== getConfig().host) return reply(403, 'This origin may not call the Valet MCP server.')

  if (request.method !== 'POST' && request.method !== 'DELETE')
    return reply(405, `/mcp does not take ${request.method}.`, { Allow: 'POST, DELETE' })

  let body: unknown
  if (request.method === 'POST') {
    let text: string
    try {
      text = await readBody(request)
    } catch (error) {
      if (error instanceof ApiError) return reply(error.status, error.message)
      throw error
    }
    try {
      body = JSON.parse(text)
    } catch {
      return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }), {
        status: 400,
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
      })
    }
  }

  const presented = request.headers.get('mcp-session-id')
  const initialising = request.method === 'POST' && isInitialize(body)
  if (!presented && !initialising) return reply(400, 'Mcp-Session-Id is missing. Send initialize first.')
  // 404 tells the client this session is gone and to initialize again; a lost session is not resumed
  if (presented && !isMcpSessionId(presented)) return reply(404, 'Unknown Mcp-Session-Id. Initialize a new session.')
  const spent = presented ? await isClosed(await getRedis(), presented) : false
  if (spent && !initialising) return reply(404, 'Unknown Mcp-Session-Id. Initialize a new session.')
  // A client that initialises again keeps the id it is holding. Minting a fresh one strands the session on an id the
  // client has no reason to read back, and clients do re-initialise mid-conversation; only a client arriving without
  // an id, or holding one already spent, is given a new one (§3.5)
  const mcpId = presented && !spent ? presented : newMcpSessionId()

  const ctx: Context = { mcpId, request, waitSeconds, caller: callerOf(body), handle: handleOf(body) }
  if (request.method === 'DELETE') {
    await closeConnection(ctx)
    return reply(200)
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await buildServer(ctx).connect(transport)
  const res = await transport.handleRequest(request, { parsedBody: body })
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(HEADERS)) headers.set(k, v)
  headers.set('Mcp-Session-Id', mcpId)
  return new Response(res.body, { status: res.status, headers })
}
