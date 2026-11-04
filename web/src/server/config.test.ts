import { describe, expect, it } from 'vitest'
import { ConfigError, readConfig } from './config'

const ENV = {
  HOST: 'https://valet.example.com',
  STORAGE_REDIS_URL: 'redis://localhost:6379',
  CRON_SECRET: 'a-secret-of-enough-length',
}

describe('readConfig', () => {
  it('defaults the prefix to valet', () => {
    expect(readConfig(ENV)).toMatchObject({ host: 'https://valet.example.com', redisPrefix: 'valet' })
  })

  it("refuses Wave's prefix in any case", () => {
    expect(() => readConfig({ ...ENV, REDIS_PREFIX: 'Wave' })).toThrow(ConfigError)
  })

  it('names what is wrong without printing values', () => {
    const problems = () => readConfig({ STORAGE_REDIS_URL: 'http://user:hunter2@host' })
    expect(problems).toThrow(/HOST is not set[\s\S]*STORAGE_REDIS_URL must start/)
    expect(problems).not.toThrow(/hunter2/)
  })

  it('falls back to the Vercel branch URL on a preview', () => {
    const { HOST: _, ...rest } = ENV
    expect(readConfig({ ...rest, VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'valet-git-app.vercel.app' }).host).toBe(
      'https://valet-git-app.vercel.app',
    )
  })
})
