export type Config = {
  host: string
  redisUrl: string
  redisPrefix: string
  cronSecret: string
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`)
    this.name = 'ConfigError'
  }
}

type Env = Record<string, string | undefined>

// Valet shares Wave's Redis, which is only safe while the prefixes differ
const WAVE_PREFIX = 'wave'
const PREFIX = /^[A-Za-z0-9_-]{1,32}$/
const MIN_CRON_SECRET = 16

function fail(problems: string[], message: string) {
  problems.push(message)
  return ''
}

function vercelHost(env: Env) {
  const host = env.VERCEL_ENV === 'production' ? env.VERCEL_PROJECT_PRODUCTION_URL : (env.VERCEL_BRANCH_URL ?? env.VERCEL_URL)
  return host ? `https://${host}` : undefined
}

function readHost(raw: string | undefined, problems: string[]) {
  if (!raw) return fail(problems, 'HOST is not set. Use the public origin, e.g. https://valet.davidsling.in')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail(problems, 'HOST is not a URL. Use an absolute origin, e.g. https://valet.davidsling.in')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail(problems, 'HOST must use http or https')
  if (url.pathname !== '/' || url.search || url.hash) return fail(problems, 'HOST must be an origin with no path, query or fragment')
  return url.origin
}

function readRedisUrl(raw: string | undefined, problems: string[]) {
  if (!raw) return fail(problems, 'STORAGE_REDIS_URL is not set')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail(problems, 'STORAGE_REDIS_URL is not a URL. Expected redis://host:port or rediss://host:port')
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return fail(problems, 'STORAGE_REDIS_URL must start with redis:// or rediss://')
  return raw
}

function readRedisPrefix(raw: string | undefined, problems: string[]) {
  const prefix = raw ?? 'valet'
  if (!PREFIX.test(prefix)) problems.push('REDIS_PREFIX must be 1 to 32 letters, digits, underscores or hyphens')
  else if (prefix.toLowerCase() === WAVE_PREFIX) problems.push(`REDIS_PREFIX must not be "${WAVE_PREFIX}": that is Wave's namespace in the shared Redis`)
  return prefix
}

function readCronSecret(raw: string | undefined, problems: string[]) {
  if (!raw) return fail(problems, 'CRON_SECRET is not set. Generate one with: openssl rand -base64 32')
  if (raw.length < MIN_CRON_SECRET) return fail(problems, `CRON_SECRET is shorter than ${MIN_CRON_SECRET} characters`)
  return raw
}

export function readConfig(env: Env): Config {
  const problems: string[] = []
  const config = {
    host: readHost(env.HOST ?? vercelHost(env), problems),
    redisUrl: readRedisUrl(env.STORAGE_REDIS_URL, problems),
    redisPrefix: readRedisPrefix(env.REDIS_PREFIX, problems),
    cronSecret: readCronSecret(env.CRON_SECRET, problems),
  }
  if (problems.length) throw new ConfigError(problems)
  return config
}

let cached: Config | undefined
export const getConfig = () => (cached ??= readConfig(process.env))
export const resetConfig = () => void (cached = undefined)
