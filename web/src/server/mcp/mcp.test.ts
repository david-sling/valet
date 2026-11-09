import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { LIMITS } from '../limits'
import { handle } from '../http'
import { keys } from '../keys'
import { closeRedis, getRedis } from '../redis'
import * as A from '../handlers/actions'
import * as S from '../handlers/sessions'
import { closedKey, idSlot, loadBinding } from './binding'
import { handleMcp } from './server'
import { newMcpSessionId } from './session-id'
import type { Params } from '../http'

// test files run in parallel against one Redis, and each wipes its own prefix
process.env.REDIS_PREFIX = 'valettest-mcp'

const URL_ = 'http://localhost:3000/mcp'
const GRANTS = [
  { id: 'g1', kind: 'Files', access: 'read', scope: '~/Library/Logs/AcmeApp/**', risk: 'low', on: true, source: 'proposed' },
]
const START = { name: 'Acme Inc.', purpose: 'Find out why AcmeApp crashes.' }
const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } }

// everything any tool returned, and everything written to the console, for the token isolation checks
let seen: string[] = []

async function connect() {
  const transport = new StreamableHTTPClientTransport(new URL(URL_), {
    fetch: (url, init) => handleMcp(new Request(url, init), { waitSeconds: 1 }),
  })
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(transport)
  return { client, transport, mcpId: transport.sessionId! }
}

async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  seen.push(JSON.stringify(result))
  return result as { structuredContent?: Record<string, any>; content: { type: string; text: string }[]; isError?: boolean }
}

type At = { token?: string; body?: unknown; params?: Params; query?: string }
async function relay(fn: (r: Request, p: Params) => Promise<Response>, { token, body, params = {}, query = '' }: At) {
  const request = new Request(`http://localhost/api/test${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const res = await handle(fn)({ request, params })
  return (await res.json()) as Record<string, any>
}

// the person at the other end: joins with the code and starts the session
async function joinAndStart(code: string) {
  const j = await relay(S.join, { body: { code } })
  await relay(S.start, { token: j.client_token, params: { id: j.session_id }, body: { grants: GRANTS } })
  return { client: j.client_token as string, id: j.session_id as string }
}

type Person = Awaited<ReturnType<typeof joinAndStart>>

// a connection with a live session, as the agent sees it, and the person at the other end
async function liveSession() {
  const c = await connect()
  const s = (await tool(c.client, 'start_session', START)).structuredContent!
  const person = await joinAndStart(s.code)
  return { ...c, person }
}

// the next action the person's app receives, as the client app would pick it up
async function nextAction(person: Person) {
  const inbox = await relay(A.inbox, { token: person.client, params: { id: person.id }, query: '?wait=5' })
  return inbox.actions.at(-1) as { action_id: string; tool: string; args: Record<string, unknown>; reason: string }
}

const answer = (person: Person, aid: string, body: Record<string, unknown>) =>
  relay(A.postResult, { token: person.client, params: { id: person.id, aid }, body })

const READ_RESULT = { content: 'boom at main.swift:42\n', hash: 'a'.repeat(64), truncated: false }

async function post(body: unknown, headers: Record<string, string> = {}, waitSeconds?: number) {
  return handleMcp(
    new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { waitSeconds },
  )
}

const call = (name: string, args: Record<string, unknown>, mcpId: string, meta?: Record<string, string>) =>
  post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } }, { 'mcp-session-id': mcpId }, 1)

const CALLER = { 'openai/subject': 'sub-abc', 'openai/session': 'conv-xyz' }
// a client that mints a new id every turn, as ChatGPT's connector does
async function coldId() {
  const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT })
  return r.headers.get('mcp-session-id')!
}

async function clean(match = 'valettest-mcp:*') {
  const redis = await getRedis()
  for await (const batch of redis.scanIterator({ MATCH: match, COUNT: 500 })) if (batch.length) await redis.del(batch)
}

describe.skipIf(!process.env.TEST_REDIS_URL)('MCP server against a local Redis', () => {
  beforeAll(() => clean())
  beforeEach(async () => {
    await clean('valettest-mcp:rl:*')
    seen = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void seen.push(args.map(String).join(' ')))
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    await clean()
    await closeRedis()
  })

  it('lists the tools, with the read tools read-only and the changing ones destructive', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'end_session',
      'list_dir',
      'list_processes',
      'read_file',
      'run_command',
      'start_session',
      'tail_log',
      'wait_for_action',
      'wait_for_session',
      'write_file',
    ])
    const by = Object.fromEntries(tools.map((t) => [t.name, t]))
    for (const t of tools) expect(t.description).toBeTruthy()
    for (const name of ['read_file', 'tail_log', 'list_dir', 'list_processes']) {
      expect(by[name].annotations).toMatchObject({ readOnlyHint: true })
      expect(by[name].inputSchema.required).toContain('reason')
    }
    for (const name of ['run_command', 'write_file']) {
      expect(by[name].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
      expect(by[name].inputSchema.required).toContain('reason')
    }
    expect(by.read_file.description).toMatch(/untrusted|not instructions/i)
    // the two lines the person reads before letting anyone in are the user's to give
    expect(by.start_session.description).toMatch(/ask them before calling this/i)
    for (const field of ['name', 'purpose'])
      expect((by.start_session.inputSchema.properties as Record<string, { description: string }>)[field].description).toMatch(/do not guess/i)
  })

  it('points every tool at a card, and lets a card call only what touches nothing on the Mac', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    const ui = (t: { _meta?: unknown }) => (t._meta as { ui: { resourceUri: string; visibility: string[] } }).ui
    for (const t of tools) {
      const session = ['start_session', 'wait_for_session', 'end_session'].includes(t.name)
      expect(ui(t).resourceUri).toBe(session ? 'ui://valet/session' : 'ui://valet/action')
      const fromCard = ['wait_for_session', 'end_session', 'wait_for_action'].includes(t.name)
      expect(ui(t).visibility).toEqual(fromCard ? ['model', 'app'] : ['model'])
    }
  })

  it('serves both cards, filled in and pointed at its own origin', async () => {
    const { client } = await connect()
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri).sort()).toEqual(['ui://valet/action', 'ui://valet/session'])
    for (const kind of ['session', 'action']) {
      const { contents } = await client.readResource({ uri: `ui://valet/${kind}` })
      const [card] = contents as { mimeType?: string; text?: string; _meta?: { ui: { csp: { resourceDomains: string[] } } } }[]
      expect(card.mimeType).toBe('text/html;profile=mcp-app')
      expect(card.text).toContain(`const KIND = '${kind}'`)
      expect(card.text).toContain("from 'http://localhost:3000/mcp-app.js'")
      expect(card.text).not.toMatch(/\{\{\w+\}\}/)
      expect(card._meta!.ui.csp.resourceDomains).toEqual(['http://localhost:3000'])
    }
  })

  it('runs a session start to end, recording that it came through MCP', async () => {
    const { client, mcpId } = await connect()
    const started = await tool(client, 'start_session', START)
    expect(started.isError).toBeFalsy()
    const s = started.structuredContent!
    expect(s).toMatchObject({ state: 'invited' })
    expect(s.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/)
    expect(s.join_url).toBe(`http://localhost:3000/j/${s.code}`)
    expect(s.expires_at).toBeGreaterThan(Date.now())
    expect(s.handoff).toContain(s.join_url)
    expect(Object.keys(s)).not.toContain('agent_token')
    expect(Object.keys(s)).not.toContain('session_id')

    const waiting = await tool(client, 'wait_for_session')
    expect(waiting.structuredContent).toMatchObject({ state: 'invited' })

    const joined = await relay(S.join, { body: { code: s.code } })
    expect(joined.source).toBe('mcp')
    await relay(S.start, { token: joined.client_token, params: { id: joined.session_id }, body: { grants: GRANTS } })
    const person = { id: joined.session_id as string }
    const redis = await getRedis()
    expect(await redis.hGet(keys.session(person.id), 'source')).toBe('mcp')

    const live = await tool(client, 'wait_for_session')
    expect(live.structuredContent).toMatchObject({ state: 'live', client_connected: true })
    expect(live.structuredContent!.allowed_without_asking).toHaveLength(1)
    // the list must never read as a ceiling: what is absent is asked for, not refused
    expect(live.structuredContent!.anything_else).toContain('asked')
    expect(live.structuredContent!.ends_at).toBeGreaterThan(Date.now())

    const ended = await tool(client, 'end_session')
    expect(ended.structuredContent).toMatchObject({ state: 'ended', ended_by: 'agent' })
    expect(await redis.hGet(keys.session(person.id), 'state')).toBe('ended')
    expect(await loadBinding(redis, idSlot(mcpId))).toBeUndefined()
  })

  it('never shows the agent token, the session ID or the MCP id in a result or a log line', async () => {
    const { client, transport, mcpId } = await connect()
    const s = (await tool(client, 'start_session', START)).structuredContent!
    const bound = (await loadBinding(await getRedis(), idSlot(mcpId)))!
    await tool(client, 'wait_for_session')
    await joinAndStart(s.code)
    await tool(client, 'wait_for_session')
    await tool(client, 'start_session', START)
    await tool(client, 'end_session')
    await tool(client, 'wait_for_session')
    await transport.terminateSession()

    const everything = seen.join('\n')
    expect(everything.length).toBeGreaterThan(0)
    for (const secret of [bound.token, bound.sessionId, mcpId]) expect(everything).not.toContain(secret)
  })

  it('refuses a second session while one is open, and allows one after it ends', async () => {
    const { client } = await connect()
    await tool(client, 'start_session', START)
    const again = await tool(client, 'start_session', START)
    expect(again.isError).toBeFalsy()
    expect(again.structuredContent).toMatchObject({ status: 'rejected', error: { code: 'conflict' } })

    await tool(client, 'end_session')
    const fresh = await tool(client, 'start_session', START)
    expect(fresh.structuredContent).toMatchObject({ state: 'invited' })
  })

  it('keeps each MCP session to its own Valet session', async () => {
    const a = await connect()
    const b = await connect()
    const sa = (await tool(a.client, 'start_session', START)).structuredContent!
    const sb = (await tool(b.client, 'start_session', START)).structuredContent!
    expect(sa.code).not.toBe(sb.code)

    await joinAndStart(sa.code)
    expect((await tool(a.client, 'wait_for_session')).structuredContent).toMatchObject({ state: 'live' })
    expect((await tool(b.client, 'wait_for_session')).structuredContent).toMatchObject({ state: 'invited' })

    await tool(a.client, 'end_session')
    expect((await tool(b.client, 'wait_for_session')).structuredContent).toMatchObject({ state: 'invited' })

    // no tool takes a session ID, so there is nothing to point at another session with
    const bBound = (await loadBinding(await getRedis(), idSlot(b.mcpId)))!
    const named = await tool(a.client, 'wait_for_session', { session_id: bBound.sessionId })
    expect(named.isError).toBe(true)
    expect(JSON.stringify(named)).not.toContain(bBound.sessionId)
  })

  it('reports an expired code, a session the person ended, and no session at all as results', async () => {
    const redis = await getRedis()

    const late = await connect()
    await tool(late.client, 'start_session', START)
    const lateId = (await loadBinding(redis, idSlot(late.mcpId)))!.sessionId
    await redis.hSet(keys.session(lateId), 'created_at', Date.now() - LIMITS.inviteMs - 1000)
    const expired = await tool(late.client, 'wait_for_session')
    expect(expired.isError).toBeFalsy()
    expect(expired.structuredContent).toMatchObject({ state: 'expired' })

    const ended = await connect()
    const s = (await tool(ended.client, 'start_session', START)).structuredContent!
    const person = await joinAndStart(s.code)
    await relay(S.end, { token: person.client, params: { id: person.id } })
    const byClient = await tool(ended.client, 'wait_for_session')
    expect(byClient.isError).toBeFalsy()
    expect(byClient.structuredContent).toMatchObject({ state: 'ended', ended_by: 'client' })

    const none = await connect()
    for (const name of ['wait_for_session', 'end_session']) {
      const r = await tool(none.client, name)
      expect(r.isError).toBeFalsy()
      expect(r.structuredContent).toMatchObject({ status: 'rejected', error: { code: 'not_found' } })
    }
  })

  it('ends the Valet session when the MCP session is closed', async () => {
    const { client, transport, mcpId } = await connect()
    await tool(client, 'start_session', START)
    const redis = await getRedis()
    const { sessionId } = (await loadBinding(redis, idSlot(mcpId)))!
    await transport.terminateSession()
    expect(await redis.hGet(keys.session(sessionId), 'state')).toBe('ended')
    expect(await loadBinding(redis, idSlot(mcpId))).toBeUndefined()

    // a closed session's id is gone for good: the client must initialize again, not start over on the old id
    const after = await post({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, { 'mcp-session-id': mcpId })
    expect(after.status).toBe(404)
    expect(await redis.ttl(closedKey(mcpId))).toBeGreaterThan(0)
  })

  it('keeps the id, and the session, when the client initialises again', async () => {
    const { client, mcpId } = await connect()
    await tool(client, 'start_session', START)
    const redis = await getRedis()
    const { sessionId } = (await loadBinding(redis, idSlot(mcpId)))!

    const again = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }, { 'mcp-session-id': mcpId })
    expect(again.status).toBe(200)
    // the id it arrived with is the id it leaves with, so a client that never reads the header back keeps working
    expect(again.headers.get('mcp-session-id')).toBe(mcpId)

    expect(await redis.hGet(keys.session(sessionId), 'state')).toBe('invited')
    expect((await loadBinding(redis, idSlot(mcpId)))!.sessionId).toBe(sessionId)
    expect((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': mcpId })).status).toBe(200)
  })

  it('finds the session by what the caller calls itself when its id did not last', async () => {
    const first = await coldId()
    const started = await (await call('start_session', START, first, CALLER)).json()
    expect(started.result.structuredContent.state).toBe('invited')
    // nothing for the model to carry: the session is reachable without anything coming back in the result
    expect(JSON.stringify(started)).not.toContain('session_handle')

    // next turn: a brand new id, and only the caller's own name to go on
    const next = await coldId()
    expect(next).not.toBe(first)
    expect((await (await call('wait_for_session', {}, next)).json()).result.structuredContent.error.code).toBe('not_found')

    const found = await (await call('wait_for_session', {}, next, CALLER)).json()
    expect(found.result.structuredContent.state).toBe('invited')
  })

  it('needs both halves of the caller to match', async () => {
    const first = await coldId()
    await call('start_session', START, first, CALLER)

    for (const wrong of [
      { ...CALLER, 'openai/session': 'conv-other' },
      { ...CALLER, 'openai/subject': 'sub-other' },
      { 'openai/session': CALLER['openai/session'] },
    ]) {
      const r = await (await call('wait_for_session', {}, await coldId(), wrong as Record<string, string>)).json()
      expect(r.result.structuredContent.error.code).toBe('not_found')
    }
  })

  it('does not promise tool list changes it has no way to send', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT })
    const capabilities = (await r.json()).result.capabilities
    expect(capabilities.tools.listChanged).toBe(false)
    expect(capabilities.resources.listChanged).toBe(false)
    // the only channel for one would be the GET stream, which a stateless server does not serve
    expect((await handleMcp(new Request(URL_, { method: 'GET' }))).status).toBe(405)
  })

  it('gives a fresh id to a client that initialises without one', async () => {
    const first = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT })
    const second = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT })
    expect(first.headers.get('mcp-session-id')).not.toBe(second.headers.get('mcp-session-id'))
  })

  it('replays a retried call rather than asking the person a second time', async () => {
    const { mcpId, person } = await liveSession()
    const call = {
      jsonrpc: '2.0',
      id: 77,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '~/Library/Logs/AcmeApp/main.log', reason: 'Reading the crash log.' } },
    }
    const sent = post(call, { 'mcp-session-id': mcpId })
    const a = await nextAction(person)
    await answer(person, a.action_id, { status: 'ok', output: READ_RESULT, hash: READ_RESULT.hash })
    expect((await (await sent).json()).result.structuredContent).toMatchObject({ action_id: a.action_id, status: 'ok' })

    // the same request id and arguments again: the first action comes back, and the person is not asked twice
    const retried = await (await post(call, { 'mcp-session-id': mcpId })).json()
    expect(retried.result.structuredContent).toMatchObject({ action_id: a.action_id, status: 'ok' })

    // a new request id is a new action, even for the same arguments
    const fresh = post({ ...call, id: 78 }, { 'mcp-session-id': mcpId })
    const b = await nextAction(person)
    expect(b.action_id).not.toBe(a.action_id)
    await answer(person, b.action_id, { status: 'ok', output: READ_RESULT, hash: READ_RESULT.hash })
    expect((await (await fresh).json()).result.structuredContent.action_id).toBe(b.action_id)
  })

  it('turns away unknown, forged and missing session ids, other origins, oversize bodies and GET', async () => {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    expect((await post(list, { 'mcp-session-id': newMcpSessionId() + 'x' })).status).toBe(404)
    expect((await post(list, { 'mcp-session-id': 'made-up' })).status).toBe(404)
    expect((await post(list)).status).toBe(400)

    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }
    expect((await post(init, { origin: 'https://evil.example' })).status).toBe(403)
    const ok = await post(init, { origin: 'http://localhost:3000' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(ok.headers.get('x-robots-tag')).toBe('noindex')

    expect((await post(JSON.stringify({ ...init, pad: 'x'.repeat(LIMITS.bodyBytes) }))).status).toBe(413)
    expect((await handleMcp(new Request(URL_))).status).toBe(405)
  })

  it('shares the session-create rate limit with POST /sessions', async () => {
    const { client } = await connect()
    for (let i = 0; i < 20; i++) {
      await tool(client, 'start_session', START)
      await tool(client, 'end_session')
    }
    const limited = await tool(client, 'start_session', START)
    expect(limited.structuredContent).toMatchObject({ status: 'rejected', error: { code: 'rate_limited' } })
  })

  it('sends an action the person allows, and returns its output', async () => {
    const { client, person } = await liveSession()
    const asked = tool(client, 'read_file', { path: '~/Library/Logs/AcmeApp/main.log', reason: 'Reading the crash log.' })
    const a = await nextAction(person)
    expect(a).toMatchObject({ tool: 'read_file', args: { path: '~/Library/Logs/AcmeApp/main.log' }, reason: 'Reading the crash log.' })
    await answer(person, a.action_id, { status: 'ok', output: READ_RESULT, hash: READ_RESULT.hash })
    const r = await asked
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent).toMatchObject({ action_id: a.action_id, tool: 'read_file', status: 'ok', output: READ_RESULT, session_state: 'live' })
    expect(r.structuredContent!.events).toEqual(expect.any(Array))
    expect(r.content[0].text).toMatch(/untrusted/i)
  })

  it('returns pending when the person takes longer than a call waits, and the answer through wait_for_action', async () => {
    const { client, person } = await liveSession()
    const r = await tool(client, 'run_command', { command: ['/usr/bin/sw_vers'], reason: 'Checking the macOS version.' })
    expect(r.structuredContent).toMatchObject({ status: 'pending', tool: 'run_command' })
    const aid = r.structuredContent!.action_id as string
    expect(aid).toMatch(/^a_/)

    const output = { exit_code: 0, stdout: 'ProductVersion: 15.1\n', stderr: '', truncated: false }
    await answer(person, aid, { status: 'approved', method: 'touch_id', output })
    const done = await tool(client, 'wait_for_action', { action_id: aid })
    expect(done.structuredContent).toMatchObject({ action_id: aid, status: 'approved', method: 'touch_id', output })

    const still = await tool(client, 'wait_for_action', { action_id: 'a_AAAAAAAAAAAA' })
    expect(still.structuredContent).toMatchObject({ status: 'rejected', error: { code: 'not_found' } })
  })

  it('returns a denial, a sandbox denial, a stale base_hash and a failure as results', async () => {
    const { client, person } = await liveSession()
    const cases = [
      [{ status: 'denied' }, 'list_dir', { path: '~/.ssh' }],
      [{ status: 'denied', error: 'sandbox: file-read-data /etc/master.passwd' }, 'run_command', { command: ['/bin/cat', '/etc/master.passwd'] }],
      [{ status: 'rejected', error: 'The file changed after it was last read.' }, 'write_file', { path: '/tmp/acme.conf', content: 'x', base_hash: 'b'.repeat(64) }],
      [{ status: 'failed', error: 'No such file or directory' }, 'tail_log', { path: '/var/log/none.log', lines: 10 }],
    ] as const
    for (const [given, name, args] of cases) {
      const asked = tool(client, name, { ...args, reason: 'Testing what comes back.' })
      const a = await nextAction(person)
      await answer(person, a.action_id, given)
      const r = await asked
      expect(r.isError).toBeFalsy()
      expect(r.structuredContent).toMatchObject({ tool: name, ...given })
    }
  })

  it('reports an action the session ended under as ended, and lets go of the session', async () => {
    const { client, person, mcpId } = await liveSession()
    const r = await tool(client, 'list_processes', { reason: 'Seeing what is running.' })
    expect(r.structuredContent).toMatchObject({ status: 'pending' })
    await relay(S.end, { token: person.client, params: { id: person.id } })
    const done = await tool(client, 'wait_for_action', { action_id: r.structuredContent!.action_id })
    expect(done.isError).toBeFalsy()
    expect(done.structuredContent).toMatchObject({ status: 'ended', session_state: 'ended' })
    expect(await loadBinding(await getRedis(), idSlot(mcpId))).toBeUndefined()
  })

  it('turns away actions before the session is live, and with no session at all', async () => {
    const early = await connect()
    await tool(early.client, 'start_session', START)
    const r = await tool(early.client, 'list_processes', { reason: 'Seeing what is running.' })
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent).toMatchObject({ status: 'rejected', error: { code: 'conflict' } })
    expect(r.structuredContent!.error.hint).toMatch(/wait_for_session/)
    expect(JSON.stringify(r)).not.toMatch(/\/api\/|Bearer|curl/)

    const none = await connect()
    for (const [name, args] of [['read_file', { path: '/etc/hosts', reason: 'Reading.' }], ['wait_for_action', { action_id: 'a_AAAAAAAAAAAA' }]] as const) {
      const n = await tool(none.client, name, args)
      expect(n.structuredContent).toMatchObject({ status: 'rejected', error: { code: 'not_found' } })
    }
  })

  it('takes only the access each kind of starting permission has, and says which in the description', async () => {
    const { client } = await connect()
    const need = (kind: string, access: string, scope: string) => ({ kind, access, scope, risk: 'low' })
    for (const wrong of [need('Files', 'list', '~/Desktop'), need('Programs', 'read', '/usr/bin/uname'), need('Processes', 'read', 'all'), need('Network', 'read', '*')]) {
      const r = await tool(client, 'start_session', { ...START, template: [wrong] })
      expect(r.isError, JSON.stringify(wrong)).toBe(true)
    }
    const right = [need('Files', 'read', '~/Desktop/**'), need('Programs', 'run', '/usr/bin/uname'), need('Processes', 'list', 'all')]
    expect((await tool(client, 'start_session', { ...START, template: right })).structuredContent).toMatchObject({ state: 'invited' })

    const { tools } = await client.listTools()
    const description = tools.find((t) => t.name === 'start_session')!.description!
    for (const rule of ['Files (read, write)', 'Processes (list', '/**', 'least']) expect(description).toContain(rule)
  })

  it('refuses arguments that break the field rules before anything reaches the person', async () => {
    const { client, person } = await liveSession()
    const bad = [
      ['read_file', { path: '/etc/hosts' }],
      ['read_file', { path: '/etc/hosts', reason: '' }],
      ['read_file', { path: '/etc/hosts', reason: 'bell\u0007' }],
      ['read_file', { path: 'relative/file', reason: 'Reading.' }],
      ['read_file', { path: '/tmp/../etc/hosts', reason: 'Reading.' }],
      ['read_file', { path: '/etc/hosts', reason: 'Reading.', session_id: person.id }],
      ['run_command', { command: [], reason: 'Running.' }],
      ['run_command', { command: '/bin/ls -la', reason: 'Running.' }],
      ['write_file', { path: '/tmp/x', content: 'x', base_hash: 'short', reason: 'Writing.' }],
      ['tail_log', { path: '/var/log/x.log', lines: 0, reason: 'Reading.' }],
      ['wait_for_action', { action_id: '../../sessions' }],
    ] as const
    for (const [name, args] of bad) {
      const r = await tool(client, name, args)
      expect(r.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
    }
    const inbox = await relay(A.inbox, { token: person.client, params: { id: person.id } })
    expect(inbox.actions).toHaveLength(0)
  })

  it('never shows the agent token, the session ID or the MCP id while running actions', async () => {
    const { client, person, mcpId } = await liveSession()
    const bound = (await loadBinding(await getRedis(), idSlot(mcpId)))!
    const asked = tool(client, 'read_file', { path: '~/Library/Logs/AcmeApp/main.log', reason: 'Reading the crash log.' })
    const a = await nextAction(person)
    await answer(person, a.action_id, { status: 'ok', output: READ_RESULT })
    await asked
    const pending = await tool(client, 'list_processes', { reason: 'Seeing what is running.' })
    await tool(client, 'wait_for_action', { action_id: pending.structuredContent!.action_id })
    await tool(client, 'end_session')

    const everything = seen.join('\n')
    for (const secret of [bound.token, bound.sessionId, mcpId]) expect(everything).not.toContain(secret)
  })


  it('counts session creates per caller behind Vercel, from the forwarded address', async () => {
    const vercel = process.env.VERCEL
    process.env.VERCEL = '1'
    try {
      const from = async (ip: string) => {
        const transport = new StreamableHTTPClientTransport(new URL(URL_), {
          fetch: (url, init) => {
            const headers = new Headers(init?.headers)
            headers.set('x-forwarded-for', ip)
            return handleMcp(new Request(url, { ...init, headers }), { waitSeconds: 1 })
          },
        })
        const client = new Client({ name: 'test', version: '0' })
        await client.connect(transport)
        return client
      }
      const a = await from('203.0.113.7')
      for (let i = 0; i < 20; i++) {
        await tool(a, 'start_session', START)
        await tool(a, 'end_session')
      }
      expect((await tool(a, 'start_session', START)).structuredContent).toMatchObject({ error: { code: 'rate_limited' } })
      const b = await from('198.51.100.9')
      expect((await tool(b, 'start_session', START)).structuredContent).toMatchObject({ state: 'invited' })
    } finally {
      if (vercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = vercel
    }
  })

  it('answers notifications with 202, an unknown tool with an error, and closing an empty connection with 200', async () => {
    const { client, transport } = await connect()
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })
    const id = init.headers.get('mcp-session-id')!
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': id })).status).toBe(202)

    const unknown = await client.callTool({ name: 'delete_everything', arguments: {} }).catch((e: unknown) => ({ isError: true, thrown: String(e) }))
    expect(unknown.isError).toBe(true)

    await transport.terminateSession()
    const closed = await handleMcp(new Request(URL_, { method: 'DELETE', headers: { 'mcp-session-id': id } }))
    expect(closed.status).toBe(200)
  })

})
