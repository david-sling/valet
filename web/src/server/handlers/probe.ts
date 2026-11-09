import { timingSafeEqual } from 'node:crypto'
import { ApiError, bearer, json } from '../http'
import { keys } from '../keys'
import { PROBE_KEEP, probing } from '../mcp/probe'
import { getRedis } from '../redis'
import { hashToken } from '../tokens'

const MIN_TOKEN = 16

const same = (a: string, b: string) => timingSafeEqual(Buffer.from(hashToken(a), 'hex'), Buffer.from(hashToken(b), 'hex'))

// Its own token, not the cron secret. The cron secret is write-only once set — Vercel will not give it back — so an
// endpoint guarded by it is an endpoint nobody can open afterwards. This one is generated to be read again.
function authorise(request: Request) {
  const want = process.env.PROBE_TOKEN
  if (!want || want.length < MIN_TOKEN) throw new ApiError(503, 'server_error', 'No probe token is configured.')
  const given = bearer(request)
  if (!given || !same(given, want)) throw new ApiError(401, 'unauthorized', 'Invalid or missing token.')
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
