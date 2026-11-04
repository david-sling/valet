import type { Redis } from './redis'

type Listener = () => void
type Topic = { listeners: Set<Listener>; ready: Promise<boolean> }
type State = { subscriber?: Promise<Redis | undefined>; topics: Map<string, Topic> }

const cache = globalThis as typeof globalThis & { __valetWake?: State }
const state = (): State => (cache.__valetWake ??= { topics: new Map() })

const report = (what: string, error: unknown) =>
  console.error(`redis(wake): ${what}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)

function subscriber(redis: Redis) {
  const s = state()
  s.subscriber ??= (async () => {
    const client = redis.duplicate({ pingInterval: 60_000 })
    client.on('error', (error: Error) => report('connection', error))
    // anything published while the socket was down is lost, so every waiting poll looks again
    client.on('ready', () => s.topics.forEach((t) => [...t.listeners].forEach((l) => l())))
    await client.connect()
    return client
  })().catch((error: unknown) => {
    s.subscriber = undefined
    report('unavailable', error)
    return undefined
  })
  return s.subscriber
}

async function listen(redis: Redis, topic: string, listener: Listener) {
  const client = await subscriber(redis)
  if (!client) return false
  const { topics } = state()
  let entry = topics.get(topic)
  if (!entry) {
    const listeners = new Set<Listener>()
    const ready = client
      .subscribe(topic, () => [...listeners].forEach((l) => l()))
      .then(() => true)
      .catch((error: unknown) => {
        topics.delete(topic)
        report('subscribe', error)
        return false
      })
    entry = { listeners, ready }
    topics.set(topic, entry)
  }
  entry.listeners.add(listener)
  return entry.ready
}

async function release(redis: Redis, topic: string, listener: Listener) {
  const { topics } = state()
  const entry = topics.get(topic)
  if (!entry) return
  entry.listeners.delete(listener)
  if (entry.listeners.size) return
  topics.delete(topic)
  const client = await subscriber(redis)
  await client?.unsubscribe(topic).catch((error: unknown) => report('unsubscribe', error))
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })

// Waits until check() returns something, a wake on the topic makes it worth checking again, or the time runs out.
// The subscription opens before the first check, so a wake in between is never missed.
export async function hold<T>(
  redis: Redis,
  topic: string,
  waitMs: number,
  signal: AbortSignal,
  tickMs: number,
  check: () => Promise<T | undefined>,
) {
  if (waitMs <= 0) return check()
  let signalled = false
  let wakeNow: Listener | undefined
  const listener = () => {
    signalled = true
    wakeNow?.()
  }
  const subscribed = await listen(redis, topic, listener)
  const deadline = Date.now() + waitMs
  try {
    for (;;) {
      const found = await check()
      if (found !== undefined || signal.aborted) return found
      const left = deadline - Date.now()
      if (left <= 0) return undefined
      if (!subscribed) {
        await sleep(Math.min(1000, left), signal)
        continue
      }
      if (signalled) {
        signalled = false
        continue
      }
      const stop = new AbortController()
      wakeNow = () => stop.abort()
      signal.addEventListener('abort', wakeNow, { once: true })
      await sleep(Math.min(tickMs, left), stop.signal)
      signal.removeEventListener('abort', wakeNow)
      wakeNow = undefined
      signalled = false
    }
  } finally {
    await release(redis, topic, listener)
  }
}

export async function closeWake() {
  const current = cache.__valetWake
  cache.__valetWake = undefined
  const client = await current?.subscriber?.catch(() => undefined)
  await client?.close().catch(() => undefined)
}
