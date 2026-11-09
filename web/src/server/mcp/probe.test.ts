import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readProbe } from '../handlers/probe'
import { keys } from '../keys'
import { closeRedis, getRedis } from '../redis'
import { handleMcp } from './server'

// test files run in parallel against one Redis, and each wipes its own prefix
process.env.REDIS_PREFIX = 'valettest-probe'

const URL_ = 'http://localhost:3000/mcp'
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } }
const TOKEN = 'test-only-probe-token'

const initialize = (meta?: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { ...INIT, ...(meta ? { _meta: meta } : {}) },
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handleMcp(
    new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
    }),
    { waitSeconds: 1 },
  )

async function entries() {
  const request = new Request('http://localhost/api/probe', { headers: { authorization: `Bearer ${TOKEN}` } })
  const body = (await (await readProbe(request)).json()) as { probing: boolean; entries: any[] }
  return body.entries
}

beforeEach(async () => {
  process.env.MCP_PROBE = '1'
  process.env.PROBE_TOKEN = TOKEN
  await (await getRedis()).del(keys.probe())
})

afterEach(() => {
  delete process.env.MCP_PROBE
  delete process.env.PROBE_TOKEN
})

afterAll(async () => {
  await closeRedis()
})

describe('the MCP probe', () => {
  it('records nothing unless it is switched on', async () => {
    delete process.env.MCP_PROBE
    await post(initialize())
    expect(await entries()).toEqual([])
  })

  it('records the call a client made', async () => {
    const res = await post(initialize())
    const [entry] = await entries()
    expect(entry.http).toBe('POST')
    expect(entry.status).toBe(res.status)
    expect(entry.rpc).toEqual(['initialize'])
    expect(entry.meta['io.modelcontextprotocol/protocolVersion']).toBeUndefined()
  })

  it('keeps protocol metadata readable', async () => {
    await post(initialize({ 'io.modelcontextprotocol/protocolVersion': '2026-07-28' }))
    const [entry] = await entries()
    expect(entry.meta['io.modelcontextprotocol/protocolVersion']).toBe('"2026-07-28"')
  })

  it("fingerprints a client's own identifiers instead of keeping them", async () => {
    await post(initialize({ 'openai/subject': 'user-123', 'openai/session': 'conv-abc' }))
    await post(initialize({ 'openai/subject': 'user-123', 'openai/session': 'conv-abc' }))
    await post(initialize({ 'openai/subject': 'someone-else', 'openai/session': 'conv-abc' }))
    const [third, second, first] = await entries()

    const subject = (e: any) => e.meta['openai/subject']
    expect(JSON.stringify(await entries())).not.toContain('user-123')
    // the same value marks the same way, which is what says whether a client holds one steady across turns
    expect(subject(first)).toBe(subject(second))
    expect(subject(third)).not.toBe(subject(first))
    expect(subject(first)).toMatch(/^string\(\d+\) [\w-]{10}$/)
  })

  it('never keeps an Authorization header', async () => {
    await post(initialize(), { authorization: 'Bearer a-real-looking-token' })
    const [entry] = await entries()
    expect(entry.headers.authorization).toBe('(present)')
    expect(JSON.stringify(entry)).not.toContain('a-real-looking-token')
  })

  it('reads back only with the token', async () => {
    await expect(readProbe(new Request('http://localhost/api/probe'))).rejects.toThrow()
    await expect(
      readProbe(new Request('http://localhost/api/probe', { headers: { authorization: 'Bearer wrong' } })),
    ).rejects.toThrow()
  })

  it('opens to nobody while no token is configured', async () => {
    delete process.env.PROBE_TOKEN
    await expect(
      readProbe(new Request('http://localhost/api/probe', { headers: { authorization: `Bearer ${TOKEN}` } })),
    ).rejects.toThrow()
  })
})
