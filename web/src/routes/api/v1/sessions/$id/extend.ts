import { createFileRoute } from '@tanstack/react-router'
import { handle } from '#/server/http'
import { extend } from '#/server/handlers/sessions'

export const Route = createFileRoute('/api/v1/sessions/$id/extend')({
  server: {
    handlers: {
      POST: handle(extend),
    },
  },
})
