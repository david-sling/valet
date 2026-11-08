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

  it('has an agent with an older or missing version pass the update on to its user', () => {
    for (const sent of [SKILL_VERSION - 1, undefined]) {
      const u = skillUpdate(sent, ORIGIN)!
      expect(u).toMatchObject({ latest: SKILL_VERSION, url: `${ORIGIN}/agent/skill.md` })
      expect(u.prompt).toContain(`curl -fsSL ${ORIGIN}/agent/skill.md -o "PATH"`)
      expect(u.prompt).toMatch(/carry on with it from step 2/)
    }
  })

  it('never has the agent write or fetch its own skill file', () => {
    const { prompt } = skillUpdate(SKILL_VERSION - 1, ORIGIN)!
    expect(prompt).toMatch(/Don't download or write that file yourself/)
    expect(prompt).not.toMatch(/replace|overwrite|reread/i)
  })
})
