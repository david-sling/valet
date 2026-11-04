import { createFileRoute } from '@tanstack/react-router'
import { handle, refuse } from '#/server/http'
import { createSession } from '#/server/handlers/sessions'

export const Route = createFileRoute('/api/v1/sessions')({
  server: {
    handlers: {
      POST: handle(createSession),
      ...refuse('POST'),
    },
  },
})
