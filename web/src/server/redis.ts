import { createClient } from 'redis'
import { getConfig } from './config'
import { closeWake } from './wake'

const create = (url: string) =>
  createClient({ url, socket: { reconnectStrategy: (retries: number) => Math.min(50 * 2 ** retries, 2_000) } })

export type Redis = ReturnType<typeof create>

const cache = globalThis as typeof globalThis & { __valetRedis?: Promise<Redis> }

async function connect() {
  const client = create(getConfig().redisUrl)
  // never log command arguments: they carry commands and output from the client's machine
  client.on('error', (error: Error) => console.error(`redis: ${error.name}: ${error.message}`))
  await client.connect()
  return client
}

export function getRedis() {
  cache.__valetRedis ??= connect().catch((error: unknown) => {
    cache.__valetRedis = undefined
    throw error
  })
  return cache.__valetRedis
}

export async function closeRedis() {
  const pending = cache.__valetRedis
  cache.__valetRedis = undefined
  await closeWake()
  const client = await pending?.catch(() => undefined)
  await client?.close()
}
