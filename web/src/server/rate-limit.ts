import { createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { getConfig } from './config'
import { ApiError } from './http'
import { keys } from './keys'
import { LIMITS } from './limits'
import { SCRIPTS, run } from './scripts'
import type { Redis } from './redis'

let salt: Buffer | undefined
const subject = (value: string) => {
  salt ??= Buffer.from(hkdfSync('sha256', getConfig().cronSecret, '', 'valet rate limits', 32))
  return createHmac('sha256', salt).update(value).digest('hex').slice(0, 32)
}

// x-forwarded-for is only trustworthy where Vercel sets it; anywhere else every caller shares one bucket
export const clientIp = (request: Request) =>
  (process.env.VERCEL && request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()) || 'local'

export async function limit(redis: Redis, scope: string, who: string, rate: { limit: number; windowS: number }) {
  const key = keys.rateLimit(scope, subject(who))
  const [count] = (await redis.multi().incr(key).expire(key, rate.windowS, 'NX').exec()) as unknown as [number]
  if (Number(count) <= rate.limit) return
  const ttl = Math.max(1, await redis.ttl(key))
  throw new ApiError(429, 'rate_limited', 'Too many requests.', `Wait ${ttl} seconds before trying again.`, {
    'Retry-After': String(ttl),
  })
}

export async function pollSlot(redis: Redis, token: string) {
  const key = keys.rateLimit('pollslots', subject(token))
  const member = randomBytes(8).toString('hex')
  const ok = await run(redis, SCRIPTS.ACQUIRE_SLOT, [key], [Date.now(), member, LIMITS.pollSlots, LIMITS.pollSlotStaleMs])
  if (!Number(ok))
    throw new ApiError(
      429,
      'rate_limited',
      `Only ${LIMITS.pollSlots} waiting requests at once per token.`,
      'Let your other waiting request finish before starting another.',
      { 'Retry-After': '5' },
    )
  return () => redis.zRem(key, member).then(() => undefined)
}
