import { createFileRoute } from '@tanstack/react-router'
import { handle, refuse } from '#/server/http'
import { decline } from '#/server/handlers/sessions'

export const Route = createFileRoute('/api/v1/sessions/$id/decline')({
  server: {
    handlers: {
      POST: handle(decline),
      ...refuse('POST'),
    },
  },
})
