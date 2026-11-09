import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { getConfig } from '../config'

const RANDOM_BYTES = 32
const TAG_BYTES = 16
const SHAPE = /^[A-Za-z0-9_-]{43}\.[a-z0-9]{1,10}\.[A-Za-z0-9_-]{22}$/

// longer than any Valet session can last (3 hours, then a day to fetch the log); a client past it initializes again
export const MCP_SESSION_TTL_S = 24 * 60 * 60

// the relay mints these at initialize without writing anything, so an unauthenticated flood costs no Redis; the tag
// proves an id came from here and when, and only start_session gives one any power
let key: { secret: string; value: Buffer } | undefined
function tagKey() {
  const secret = getConfig().cronSecret
  if (key?.secret !== secret) key = { secret, value: Buffer.from(hkdfSync('sha256', secret, '', 'valet mcp session ids', 32)) }
  return key.value
}

const tag = (signed: string) => createHmac('sha256', tagKey()).update(signed).digest().subarray(0, TAG_BYTES)
const nowS = () => Math.floor(Date.now() / 1000)

export function newMcpSessionId() {
  const signed = `${randomBytes(RANDOM_BYTES).toString('base64url')}.${nowS().toString(36)}`
  return `${signed}.${tag(signed).toString('base64url')}`
}

export function mcpSessionExpiresAt(value: string) {
  return Number.parseInt(value.split('.')[1] ?? '', 36) + MCP_SESSION_TTL_S
}

export function isMcpSessionId(value: string) {
  if (!SHAPE.test(value)) return false
  const cut = value.lastIndexOf('.')
  const given = Buffer.from(value.slice(cut + 1), 'base64url')
  if (given.length !== TAG_BYTES || !timingSafeEqual(given, tag(value.slice(0, cut)))) return false
  return nowS() < mcpSessionExpiresAt(value)
}
