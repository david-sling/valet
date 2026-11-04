import { describe, expect, it } from 'vitest'
import { CODE_CHARS } from '@valet/protocol'
import { hashToken, isActionId, isSessionId, newActionId, newCode, newSessionId, newToken, tokenMatches } from './tokens'

describe('tokens', () => {
  it('matches only the token it was hashed from', () => {
    const token = newToken()
    const hash = hashToken(token)
    expect(tokenMatches(token, hash)).toBe(true)
    expect(tokenMatches(newToken(), hash)).toBe(false)
    expect(tokenMatches(undefined, hash)).toBe(false)
    expect(tokenMatches(token, 'not-a-hash')).toBe(false)
  })

  it('makes IDs that pass their own shape checks', () => {
    expect(isSessionId(newSessionId())).toBe(true)
    expect(isActionId(newActionId())).toBe(true)
    expect(isSessionId('../../etc')).toBe(false)
  })

  it('draws codes only from the unambiguous characters', () => {
    const code = newCode()
    expect(code).toHaveLength(6)
    expect([...code].every((c) => CODE_CHARS.includes(c))).toBe(true)
  })
})
