import { createFileRoute } from '@tanstack/react-router'
import { handle, refuse } from '#/server/http'
import { status } from '#/server/handlers/sessions'

export const Route = createFileRoute('/api/v1/sessions/$id')({
  server: {
    handlers: {
      GET: handle(status),
      ...refuse('GET'),
    },
  },
})
