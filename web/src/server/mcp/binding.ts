import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { keys } from '../keys'
import type { Redis } from '../redis'
import { mcpSessionExpiresAt } from './session-id'
import type { Caller } from './caller'

export type Binding = { sessionId: string; token: string }
// where a binding lives: the Redis key, and the secret it is sealed under. Redis holds only hashes of credentials,
// and the secret never reaches it, so a copy of Redis alone opens no session
export type Slot = { secret: string; key: string }
// a binding and the slot it answered from. Everything downstream takes this and never asks which slot it was
export type Bound = { slot: Slot; binding: Binding }

const IV_BYTES = 12
const TAG_BYTES = 16

const hashed = (secret: string) => createHash('sha256').update(secret, 'utf8').digest('hex')
const slot = (secret: string, key: (hash: string) => string): Slot => ({ secret, key: key(hashed(secret)) })

export const idSlot = (mcpId: string) => slot(mcpId, keys.mcp)
// both halves are needed to open it, so neither one alone reaches a session
export const callerSlot = ({ subject, session }: Caller) => slot(`${subject}\u0000${session}`, keys.mcpCaller)

export const closedKey = (mcpId: string) => keys.mcpClosed(hashed(mcpId))

const sealKey = (secret: string) => Buffer.from(hkdfSync('sha256', secret, '', 'valet mcp binding', 32))

function seal({ secret, key }: Slot, binding: Binding) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', sealKey(secret), iv)
  cipher.setAAD(Buffer.from(key))
  const body = Buffer.concat([cipher.update(JSON.stringify(binding), 'utf8'), cipher.final()])
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url')
}

function open({ secret, key }: Slot, sealed: string): Binding | undefined {
  try {
    const raw = Buffer.from(sealed, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', sealKey(secret), raw.subarray(0, IV_BYTES))
    decipher.setAAD(Buffer.from(key))
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES))
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString('utf8')
    const b = JSON.parse(text) as Binding
    return typeof b.sessionId === 'string' && typeof b.token === 'string' ? b : undefined
  } catch {
    return undefined
  }
}

// false if this slot is already bound: one Valet session per slot at a time
export async function saveBinding(redis: Redis, s: Slot, binding: Binding, expireAtS: number) {
  const set = await redis.set(s.key, seal(s, binding), { condition: 'NX', expiration: { type: 'EXAT', value: expireAtS } })
  return set !== null
}

export async function loadBinding(redis: Redis, s: Slot) {
  const sealed = await redis.get(s.key)
  return sealed ? open(s, sealed) : undefined
}

export async function dropBinding(redis: Redis, s: Slot) {
  await redis.del(s.key)
}

// a binding lives exactly as long as the Valet session's keys do
export async function followSession(redis: Redis, s: Slot, sessionId: string) {
  const at = await redis.expireTime(keys.session(sessionId))
  if (at > 0) await redis.expireAt(s.key, at)
  else await dropBinding(redis, s)
}

// the first slot that holds a session, in the order the caller offered them
export async function findBinding(redis: Redis, slots: Slot[]): Promise<Bound | undefined> {
  for (const s of slots) {
    const binding = await loadBinding(redis, s)
    if (binding) return { slot: s, binding }
  }
  return undefined
}

// ids are stateless, so a closed one would otherwise still verify; it is remembered as closed until it would have
// expired on its own, after which the signature check turns it away
export async function closeMcpSession(redis: Redis, mcpId: string) {
  await redis.set(closedKey(mcpId), '1', { expiration: { type: 'EXAT', value: mcpSessionExpiresAt(mcpId) } })
}

export async function isClosed(redis: Redis, mcpId: string) {
  return (await redis.exists(closedKey(mcpId))) === 1
}
