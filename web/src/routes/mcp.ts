import { createFileRoute } from '@tanstack/react-router'
import { toErrorResponse } from '#/server/http'
import { handleMcp } from '#/server/mcp/server'

const serve = ({ request }: { request: Request }) => handleMcp(request).catch(toErrorResponse)

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: { GET: serve, POST: serve, PUT: serve, PATCH: serve, DELETE: serve },
  },
})
