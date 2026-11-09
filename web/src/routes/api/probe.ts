import { createFileRoute } from '@tanstack/react-router'
import { clearProbe, readProbe } from '#/server/handlers/probe'
import { handle, refuse } from '#/server/http'

export const Route = createFileRoute('/api/probe')({
  server: {
    handlers: {
      GET: handle(readProbe),
      DELETE: handle(clearProbe),
      ...refuse('GET', 'DELETE'),
    },
  },
})
