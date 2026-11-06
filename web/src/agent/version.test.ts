import { describe, expect, it } from 'vitest'
import { SKILL_VERSION, skillUpdate } from './version'

const ORIGIN = 'https://valet.example.com'

describe('skillUpdate', () => {
  it('reads the version from the create command in skill.md', () => {
    expect(SKILL_VERSION).toBeGreaterThan(1)
  })

  it('says nothing to an agent on the latest version, sent as a number or a string', () => {
    expect(skillUpdate(SKILL_VERSION, ORIGIN)).toBeUndefined()
    expect(skillUpdate(String(SKILL_VERSION), ORIGIN)).toBeUndefined()
  })

  it('tells an agent with an older or missing version where the latest skill is', () => {
    for (const sent of [SKILL_VERSION - 1, undefined]) {
      const u = skillUpdate(sent, ORIGIN)!
      expect(u).toMatchObject({ latest: SKILL_VERSION, url: `${ORIGIN}/agent/skill.md` })
      expect(u.prompt).toContain(`${ORIGIN}/agent/skill.md`)
      expect(u.prompt).toContain(`skill_version: ${SKILL_VERSION}`)
      expect(u.prompt).toContain(`curl -fsSL ${ORIGIN}/agent/skill.md -o "PATH"`)
    }
  })
})
