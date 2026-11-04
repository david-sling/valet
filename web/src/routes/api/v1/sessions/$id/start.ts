import { createFileRoute } from '@tanstack/react-router'
import { handle } from '#/server/http'
import { start } from '#/server/handlers/sessions'

export const Route = createFileRoute('/api/v1/sessions/$id/start')({
  server: {
    handlers: {
      POST: handle(start),
    },
  },
})
