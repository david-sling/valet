import { createFileRoute } from '@tanstack/react-router'
import { handle, refuse } from '#/server/http'
import { sweep } from '#/server/handlers/sweep'

export const Route = createFileRoute('/api/cron/sweep')({
  server: {
    handlers: {
      GET: handle(sweep),
      ...refuse('GET'),
    },
  },
})
