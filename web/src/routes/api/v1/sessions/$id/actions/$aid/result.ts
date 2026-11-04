import { createFileRoute } from '@tanstack/react-router'
import { handle, refuse } from '#/server/http'
import { postResult } from '#/server/handlers/actions'

export const Route = createFileRoute('/api/v1/sessions/$id/actions/$aid/result')({
  server: {
    handlers: {
      POST: handle(postResult),
      ...refuse('POST'),
    },
  },
})
