import { createFileRoute } from '@tanstack/react-router'
import { handle } from '#/server/http'
import { end } from '#/server/handlers/sessions'

export const Route = createFileRoute('/api/v1/sessions/$id/end')({
  server: {
    handlers: {
      POST: handle(end),
    },
  },
})
