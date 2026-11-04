import { createFileRoute } from '@tanstack/react-router'
import { handle, refuse } from '#/server/http'
import { postAction } from '#/server/handlers/actions'

export const Route = createFileRoute('/api/v1/sessions/$id/actions')({
  server: {
    handlers: {
      POST: handle(postAction),
      ...refuse('POST'),
    },
  },
})
