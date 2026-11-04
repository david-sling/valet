import { timingSafeEqual } from 'node:crypto'
import { getConfig } from '../config'
import { ApiError, bearer, json } from '../http'
import { keys } from '../keys'
import { getRedis } from '../redis'
import { FINAL, readSession, settle } from '../session'
import { hashToken } from '../tokens'

const same = (a: string, b: string) => timingSafeEqual(Buffer.from(hashToken(a), 'hex'), Buffer.from(hashToken(b), 'hex'))

export async function sweep(request: Request) {
  const token = bearer(request)
  if (!token || !same(token, getConfig().cronSecret)) throw new ApiError(401, 'unauthorized', 'Invalid or missing token.')
  const redis = await getRedis()
  const due = await redis.zRangeByScore(keys.activeSessions(), '-inf', Date.now(), { LIMIT: { offset: 0, count: 500 } })
  let settled = 0
  let removed = 0
  for (const id of due) {
    const s = await readSession(redis, id)
    if (!s) {
      await redis.zRem(keys.activeSessions(), id)
      removed++
      continue
    }
    const after = await settle(redis, s)
    if (after.state !== s.state) settled++
    else if (FINAL.includes(after.state)) {
      await redis.zRem(keys.activeSessions(), id)
      removed++
    }
  }
  return json({ checked: due.length, settled, removed })
}
