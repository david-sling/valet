import { createFileRoute } from '@tanstack/react-router'
import { handle } from '#/server/http'
import { join } from '#/server/handlers/sessions'

export const Route = createFileRoute('/api/v1/join')({
  server: {
    handlers: {
      POST: handle(join),
    },
  },
})
