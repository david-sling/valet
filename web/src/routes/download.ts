import { createFileRoute } from '@tanstack/react-router'
import { RELEASE_DMG } from '#/lib/links'

export const Route = createFileRoute('/download')({
  server: {
    handlers: {
      GET: () => new Response(null, { status: 302, headers: { Location: RELEASE_DMG, 'Cache-Control': 'public, max-age=300' } }),
    },
  },
})
