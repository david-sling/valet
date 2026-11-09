import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConfig } from '../config'
import { MCP_SESSION_TTL_S, isMcpSessionId, mcpSessionExpiresAt, newMcpSessionId } from './session-id'

describe('Mcp-Session-Id', () => {
  beforeEach(() => {
    Object.assign(process.env, { HOST: 'http://localhost:3000', STORAGE_REDIS_URL: 'redis://localhost:6379', CRON_SECRET: 'test-only-cron-secret' })
    resetConfig()
  })
  afterEach(() => vi.useRealTimers())

  it('verifies the ids it mints and they are unguessable', () => {
    const a = newMcpSessionId()
    const b = newMcpSessionId()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+\.[a-z0-9]+\.[A-Za-z0-9_-]+$/)
    expect(isMcpSessionId(a)).toBe(true)
  })

  it('refuses a tampered, truncated or made-up id', () => {
    const id = newMcpSessionId()
    const [random, at, tag] = id.split('.')
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1)
    const later = (Number.parseInt(at, 36) + 1).toString(36)
    for (const bad of [`${flip(random)}.${at}.${tag}`, `${random}.${later}.${tag}`, `${random}.${at}.${flip(tag)}`, `${random}.${tag}`, random, '', 'abc.def.ghi', `${id}x`, 'a'.repeat(5000)])
      expect(isMcpSessionId(bad)).toBe(false)
  })

  it('refuses an id minted under another secret', () => {
    const id = newMcpSessionId()
    process.env.CRON_SECRET = 'a-different-secret-entirely'
    resetConfig()
    expect(isMcpSessionId(id)).toBe(false)
  })

  it('lasts a day, and says when it runs out', () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T10:00:00Z') })
    const id = newMcpSessionId()
    expect(mcpSessionExpiresAt(id)).toBe(Math.floor(Date.now() / 1000) + MCP_SESSION_TTL_S)
    vi.setSystemTime(new Date('2026-11-10T09:59:00Z'))
    expect(isMcpSessionId(id)).toBe(true)
    vi.setSystemTime(new Date('2026-11-10T10:00:01Z'))
    expect(isMcpSessionId(id)).toBe(false)
  })
})
