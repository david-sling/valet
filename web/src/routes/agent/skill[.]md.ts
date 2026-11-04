import { createFileRoute } from '@tanstack/react-router'
import { publicOrigin } from '#/server/config'
import skill from '#/agent/skill.md?raw'

export const Route = createFileRoute('/agent/skill.md')({
  server: {
    handlers: {
      GET: () =>
        new Response(skill.replaceAll('{{BASE}}', `${publicOrigin()}/api/v1`), {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
        }),
    },
  },
})
