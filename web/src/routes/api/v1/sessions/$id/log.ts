import { createFileRoute } from '@tanstack/react-router'
import { handle } from '#/server/http'
import { getLog, putLog } from '#/server/handlers/actions'

export const Route = createFileRoute('/api/v1/sessions/$id/log')({
  server: {
    handlers: {
      GET: handle(getLog),
      PUT: handle(putLog),
    },
  },
})
