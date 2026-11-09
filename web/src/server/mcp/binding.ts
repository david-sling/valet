import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { keys } from '../keys'
import type { Redis } from '../redis'
import { mcpSessionExpiresAt } from './session-id'

export type Binding = { sessionId: string; token: string }

const IV_BYTES = 12
const TAG_BYTES = 16

// Redis holds only hashes of credentials. The binding has to give the agent token back, so it is sealed under a key
// derived from the Mcp-Session-Id, which Redis never sees: a copy of Redis alone opens no session
const idHash = (mcpId: string) => createHash('sha256').update(mcpId, 'utf8').digest('hex')
export const bindingKey = (mcpId: string) => keys.mcp(idHash(mcpId))
export const closedKey = (mcpId: string) => keys.mcpClosed(idHash(mcpId))
const sealKey = (mcpId: string) => Buffer.from(hkdfSync('sha256', mcpId, '', 'valet mcp binding', 32))

function seal(mcpId: string, binding: Binding) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', sealKey(mcpId), iv)
  cipher.setAAD(Buffer.from(bindingKey(mcpId)))
  const body = Buffer.concat([cipher.update(JSON.stringify(binding), 'utf8'), cipher.final()])
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url')
}

function open(mcpId: string, sealed: string): Binding | undefined {
  try {
    const raw = Buffer.from(sealed, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', sealKey(mcpId), raw.subarray(0, IV_BYTES))
    decipher.setAAD(Buffer.from(bindingKey(mcpId)))
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES))
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString('utf8')
    const b = JSON.parse(text) as Binding
    return typeof b.sessionId === 'string' && typeof b.token === 'string' ? b : undefined
  } catch {
    return undefined
  }
}

// false if this MCP session is already bound: one Valet session per MCP session at a time
export async function saveBinding(redis: Redis, mcpId: string, binding: Binding, expireAtS: number) {
  const set = await redis.set(bindingKey(mcpId), seal(mcpId, binding), { condition: 'NX', expiration: { type: 'EXAT', value: expireAtS } })
  return set !== null
}

export async function loadBinding(redis: Redis, mcpId: string) {
  const sealed = await redis.get(bindingKey(mcpId))
  return sealed ? open(mcpId, sealed) : undefined
}

export async function dropBinding(redis: Redis, mcpId: string) {
  await redis.del(bindingKey(mcpId))
}

// the binding lives exactly as long as the Valet session's keys do
export async function followSession(redis: Redis, mcpId: string, sessionId: string) {
  const at = await redis.expireTime(keys.session(sessionId))
  if (at > 0) await redis.expireAt(bindingKey(mcpId), at)
  else await dropBinding(redis, mcpId)
}

// ids are stateless, so a closed one would otherwise still verify; it is remembered as closed until it would have
// expired on its own, after which the signature check turns it away
export async function closeMcpSession(redis: Redis, mcpId: string) {
  await redis.set(closedKey(mcpId), '1', { expiration: { type: 'EXAT', value: mcpSessionExpiresAt(mcpId) } })
}

export async function isClosed(redis: Redis, mcpId: string) {
  return (await redis.exists(closedKey(mcpId))) === 1
}
