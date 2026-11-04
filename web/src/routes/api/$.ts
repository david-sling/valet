import { createFileRoute } from '@tanstack/react-router'
import { missing } from '#/server/handlers/missing'

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: { GET: missing, POST: missing, PUT: missing, PATCH: missing, DELETE: missing },
  },
})
