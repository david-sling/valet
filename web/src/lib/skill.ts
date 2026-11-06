import { createServerFn } from '@tanstack/react-start'
import { publicOrigin } from '#/server/config'

export const getSkillUrl = createServerFn({ method: 'GET' }).handler(() => `${publicOrigin()}/agent/skill.md`)
