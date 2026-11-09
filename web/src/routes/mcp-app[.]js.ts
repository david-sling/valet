import { createFileRoute } from '@tanstack/react-router'
import client from '@modelcontextprotocol/ext-apps/app-with-deps?raw'

// The card runs in the host's sandbox, on an origin of its own, and imports this module from here: a cross-origin
// module fetch, so it needs CORS. It is the published client bundle and carries nothing of any session
const HEADERS = {
  'Content-Type': 'text/javascript; charset=utf-8',
  'Cache-Control': 'public, max-age=3600',
  'Access-Control-Allow-Origin': '*',
  'X-Robots-Tag': 'noindex',
}

export const Route = createFileRoute('/mcp-app.js')({
  server: {
    handlers: { GET: () => new Response(client, { headers: HEADERS }) },
  },
})
