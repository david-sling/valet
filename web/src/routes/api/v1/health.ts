import { createFileRoute } from '@tanstack/react-router'
import { getRedis } from '#/server/redis'
import { handle, json, refuse } from '#/server/http'

export const Route = createFileRoute('/api/v1/health')({
  server: {
    handlers: {
      GET: handle(async () => {
        const redis = await getRedis()
        await redis.ping()
        return json({ ok: true })
      }),
      ...refuse('GET'),
    },
  },
})
