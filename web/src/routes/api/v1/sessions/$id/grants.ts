import { createFileRoute } from '@tanstack/react-router'
import { handle } from '#/server/http'
import { putGrants } from '#/server/handlers/actions'

export const Route = createFileRoute('/api/v1/sessions/$id/grants')({
  server: {
    handlers: {
      PUT: handle(putGrants),
    },
  },
})
