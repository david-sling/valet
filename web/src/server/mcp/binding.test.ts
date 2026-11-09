import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { keys } from '../keys'
import { closeRedis, getRedis } from '../redis'
import { newSessionId, newToken } from '../tokens'
import { closeMcpSession, closedKey, dropBinding, followSession, idSlot, isClosed, loadBinding, saveBinding } from './binding'
import { newMcpSessionId } from './session-id'

async function clean() {
  const redis = await getRedis()
  for await (const batch of redis.scanIterator({ MATCH: 'valettest-binding:*', COUNT: 500 })) if (batch.length) await redis.del(batch)
}

// test files run in parallel against one Redis, and each wipes its own prefix
process.env.REDIS_PREFIX = 'valettest-binding'

const soon = () => Math.ceil(Date.now() / 1000) + 600

describe.skipIf(!process.env.TEST_REDIS_URL)('MCP binding against a local Redis', () => {
  beforeAll(() => clean())
  afterAll(async () => {
    await clean()
    await closeRedis()
  })

  it('round-trips, and Redis holds neither the token, the session ID nor the MCP id', async () => {
    const redis = await getRedis()
    const mcp = newMcpSessionId()
    const bound = { sessionId: newSessionId(), token: newToken() }
    expect(await saveBinding(redis, idSlot(mcp), bound, soon())).toBe(true)
    expect(await loadBinding(redis, idSlot(mcp))).toEqual(bound)

    const all: string[] = []
    for await (const batch of redis.scanIterator({ MATCH: 'valettest-binding:*', COUNT: 500 }))
      for (const key of batch) all.push(key, String(await redis.get(key)))
    const dump = all.join('\n')
    for (const secret of [bound.token, bound.sessionId, mcp]) expect(dump).not.toContain(secret)
    expect(await redis.ttl(idSlot(mcp).key)).toBeGreaterThan(0)
  })

  it('keeps the first binding when a second one races it', async () => {
    const redis = await getRedis()
    const mcp = newMcpSessionId()
    const first = { sessionId: newSessionId(), token: newToken() }
    expect(await saveBinding(redis, idSlot(mcp), first, soon())).toBe(true)
    expect(await saveBinding(redis, idSlot(mcp), { sessionId: newSessionId(), token: newToken() }, soon())).toBe(false)
    expect(await loadBinding(redis, idSlot(mcp))).toEqual(first)
  })

  it('reads nothing for another MCP id or a tampered value', async () => {
    const redis = await getRedis()
    const mcp = newMcpSessionId()
    await saveBinding(redis, idSlot(mcp), { sessionId: newSessionId(), token: newToken() }, soon())
    expect(await loadBinding(redis, idSlot(newMcpSessionId()))).toBeUndefined()

    // the same ciphertext under another id's key must not open: the key name is bound into the encryption
    const other = newMcpSessionId()
    await redis.set(idSlot(other).key, String(await redis.get(idSlot(mcp).key)))
    expect(await loadBinding(redis, idSlot(other))).toBeUndefined()

    const raw = String(await redis.get(idSlot(mcp).key))
    await redis.set(idSlot(mcp).key, raw.slice(0, -2) + (raw.endsWith('AA') ? 'BB' : 'AA'))
    expect(await loadBinding(redis, idSlot(mcp))).toBeUndefined()
  })

  it('drops a binding', async () => {
    const redis = await getRedis()
    const mcp = newMcpSessionId()
    await saveBinding(redis, idSlot(mcp), { sessionId: newSessionId(), token: newToken() }, soon())
    await dropBinding(redis, idSlot(mcp))
    expect(await loadBinding(redis, idSlot(mcp))).toBeUndefined()
  })

  it("follows the Valet session's expiry, and goes when the session's keys have gone", async () => {
    const redis = await getRedis()
    const mcp = newMcpSessionId()
    const sessionId = newSessionId()
    await saveBinding(redis, idSlot(mcp), { sessionId, token: newToken() }, soon())

    const later = Math.ceil(Date.now() / 1000) + 7200
    await redis.hSet(keys.session(sessionId), { state: 'live' })
    await redis.expireAt(keys.session(sessionId), later)
    await followSession(redis, idSlot(mcp), sessionId)
    expect(await redis.expireTime(idSlot(mcp).key)).toBe(later)

    await redis.del(keys.session(sessionId))
    await followSession(redis, idSlot(mcp), sessionId)
    expect(await loadBinding(redis, idSlot(mcp))).toBeUndefined()
  })

  it('remembers a closed MCP session until its id would have run out anyway, holding only a hash of it', async () => {
    const redis = await getRedis()
    const mcp = newMcpSessionId()
    expect(await isClosed(redis, mcp)).toBe(false)
    await closeMcpSession(redis, mcp)
    expect(await isClosed(redis, mcp)).toBe(true)
    expect(await isClosed(redis, newMcpSessionId())).toBe(false)
    expect(closedKey(mcp)).not.toContain(mcp)
    const ttl = await redis.ttl(closedKey(mcp))
    expect(ttl).toBeGreaterThan(24 * 3600 - 60)
    expect(ttl).toBeLessThanOrEqual(24 * 3600)
  })
})
