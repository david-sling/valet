import { createFileRoute } from '@tanstack/react-router'
import { handle, refuse } from '#/server/http'
import { events } from '#/server/handlers/actions'

export const Route = createFileRoute('/api/v1/sessions/$id/events')({
  server: {
    handlers: {
      GET: handle(events),
      ...refuse('GET'),
    },
  },
})
