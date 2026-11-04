import { createFileRoute } from '@tanstack/react-router'
import { handle, refuse } from '#/server/http'
import { inbox } from '#/server/handlers/actions'

export const Route = createFileRoute('/api/v1/sessions/$id/inbox')({
  server: {
    handlers: {
      GET: handle(inbox),
      ...refuse('GET'),
    },
  },
})
