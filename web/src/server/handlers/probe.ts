import { timingSafeEqual } from 'node:crypto'
import { getConfig } from '../config'
import { ApiError, bearer, json } from '../http'
import { keys } from '../keys'
import { PROBE_KEEP, probing } from '../mcp/probe'
import { getRedis } from '../redis'
import { hashToken } from '../tokens'

const same = (a: string, b: string) => timingSafeEqual(Buffer.from(hashToken(a), 'hex'), Buffer.from(hashToken(b), 'hex'))

function authorise(request: Request) {
  const token = bearer(request)
  if (!token || !same(token, getConfig().cronSecret)) throw new ApiError(401, 'unauthorized', 'Invalid or missing token.')
}

export async function readProbe(request: Request) {
  authorise(request)
  if (!probing()) return json({ probing: false, entries: [] })
  const redis = await getRedis()
  const raw = await redis.lRange(keys.probe(), 0, PROBE_KEEP - 1)
  return json({ probing: true, entries: raw.map((entry) => JSON.parse(entry)) })
}

export async function clearProbe(request: Request) {
  authorise(request)
  const redis = await getRedis()
  await redis.del(keys.probe())
  return json({ cleared: true })
}
