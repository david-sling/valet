import { createFileRoute } from '@tanstack/react-router'
import { handle } from '#/server/http'
import { getAction } from '#/server/handlers/actions'

export const Route = createFileRoute('/api/v1/sessions/$id/actions/$aid')({
  server: {
    handlers: {
      GET: handle(getAction),
    },
  },
})
