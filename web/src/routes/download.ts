import { createFileRoute } from '@tanstack/react-router'
import { downloadFor } from '#/lib/links'

export const Route = createFileRoute('/download')({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(null, {
          status: 302,
          headers: {
            Location: downloadFor(request.url, request.headers.get('user-agent')),
            // the answer depends on who asks, so no shared cache may hand one person's download to another
            'Cache-Control': 'private, max-age=300',
            Vary: 'User-Agent',
          },
        }),
    },
  },
})
