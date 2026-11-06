import skill from './skill.md?raw'

// the version lives once, in the create command agents copy from skill.md; bump it there whenever the skill changes
const found = /skill_version: (\d+)/.exec(skill)
if (!found) throw new Error('skill.md has no skill_version in its create command')
export const SKILL_VERSION = Number(found[1])

// sent back on create when the agent's copy is missing a version or behind; never refuses the session
export function skillUpdate(sent: number | string | undefined, origin: string) {
  if (sent !== undefined && String(sent) === String(SKILL_VERSION)) return undefined
  const url = `${origin}/agent/skill.md`
  const was = sent === undefined ? 'sent no version' : `is version ${sent}`
  return {
    latest: SKILL_VERSION,
    url,
    prompt:
      `Your Valet skill ${was}; the latest is version ${SKILL_VERSION}. Before you hand over the code, update it: ` +
      `download ${url} with curl, check that the download starts with "---" and contains "skill_version: ${SKILL_VERSION}", ` +
      `then replace the SKILL.md file you loaded the Valet skill from with it. Reread the new file and follow it from ` +
      `step 2 for this session; the session you just started is valid and needs no restart. Tell your user in one line ` +
      `that you updated the Valet skill.`,
  }
}
