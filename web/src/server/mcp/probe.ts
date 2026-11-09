import { createHmac, hkdfSync } from 'node:crypto'
import { getConfig } from '../config'
import { keys } from '../keys'
import { getRedis } from '../redis'

export const PROBE_KEEP = 200
const PROBE_TTL_S = 24 * 60 * 60

// What a client is, never who it says someone is. A client's own name for a caller — ChatGPT's openai/subject, or
// whatever Gemini turns out to send — is a secret that happens to be stable, so it is fingerprinted rather than kept:
// a fingerprint that repeats answers "does this hold across turns" without the probe ever storing the value.
const PLAIN_HEADERS = ['mcp-protocol-version', 'mcp-method', 'mcp-name', 'content-type', 'accept', 'user-agent']
const PLAIN_META = /^io\.modelcontextprotocol\//

export const probing = () => process.env.MCP_PROBE === '1'

let key: { secret: string; value: Buffer } | undefined
function markKey() {
  const secret = getConfig().cronSecret
  if (key?.secret !== secret) key = { secret, value: Buffer.from(hkdfSync('sha256', secret, '', 'valet probe fingerprints', 32)) }
  return key.value
}

const mark = (value: string) => createHmac('sha256', markKey()).update(value).digest('base64url').slice(0, 10)

const messages = (body: unknown) => [body].flat().filter((m): m is Record<string, any> => !!m && typeof m === 'object')

const text = (v: unknown) => (typeof v === 'string' ? v : undefined)

function readMeta(body: unknown) {
  const seen: Record<string, string> = {}
  for (const message of messages(body)) {
    const meta = message.params?._meta
    if (!meta || typeof meta !== 'object') continue
    for (const [name, value] of Object.entries(meta)) {
      const shown = JSON.stringify(value) ?? 'undefined'
      seen[name] = PLAIN_META.test(name) ? shown : `${typeof value}(${shown.length}) ${mark(shown)}`
    }
  }
  return seen
}

function readHeaders(request: Request) {
  const seen: Record<string, string> = {}
  for (const [name, value] of request.headers) {
    if (name === 'authorization' || name === 'cookie') seen[name] = '(present)'
    else if (PLAIN_HEADERS.includes(name)) seen[name] = value
    else if (name === 'mcp-session-id') seen[name] = mark(value)
    else seen[name] = `(${value.length} chars)`
  }
  return seen
}

export async function record(request: Request, status: number) {
  let body: unknown
  if (request.method === 'POST') {
    try {
      body = JSON.parse(await request.text())
    } catch {}
  }
  const entry = {
    at: new Date().toISOString(),
    http: request.method,
    status,
    rpc: messages(body)
      .map((m) => text(m.method))
      .filter(Boolean),
    tools: messages(body)
      .map((m) => text(m.params?.name))
      .filter(Boolean),
    headers: readHeaders(request),
    meta: readMeta(body),
  }
  const redis = await getRedis()
  await redis.lPush(keys.probe(), JSON.stringify(entry))
  await redis.lTrim(keys.probe(), 0, PROBE_KEEP - 1)
  await redis.expire(keys.probe(), PROBE_TTL_S)
}
