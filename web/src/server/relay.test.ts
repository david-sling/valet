import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { handle } from './http'
import { keys } from './keys'
import { closeRedis, getRedis } from './redis'
import * as A from './handlers/actions'
import * as S from './handlers/sessions'
import { sweep } from './handlers/sweep'
import type { Params } from './http'

type Fn = (request: Request, params: Params) => Promise<Response>
type Call = { method?: string; token?: string; body?: unknown; raw?: string; query?: string; params?: Params }

async function call(fn: Fn, { method = 'GET', token, body, raw, query = '', params = {} }: Call = {}) {
  const request = new Request(`http://localhost/api/test${query}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const res = await handle(fn)({ request, params })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

const GRANTS = [
  { id: 'g1', kind: 'Files', access: 'read', scope: '~/Library/Logs/AcmeApp/**', risk: 'low', on: true, source: 'proposed' },
  { id: 'g2', kind: 'Programs', access: 'run', scope: '/usr/bin/log', risk: 'medium', on: false, source: 'proposed' },
]
const READ = { tool: 'read_file', args: { path: '~/Library/Logs/AcmeApp/main.log' }, reason: 'Reading the crash log.' }
let n = 0
const cid = () => `test-client-id-${++n}`

async function clean(match = 'valettest:*') {
  const redis = await getRedis()
  for await (const batch of redis.scanIterator({ MATCH: match, COUNT: 500 })) if (batch.length) await redis.del(batch)
}

async function create() {
  const r = await call(S.createSession, {
    method: 'POST',
    body: { name: 'Acme Inc.', agent: 'Acme support agent', purpose: 'Find out why AcmeApp crashes.' },
  })
  expect(r.status).toBe(201)
  return r.body as { session_id: string; agent_token: string; code: string }
}

async function live() {
  const s = await create()
  const j = await call(S.join, { method: 'POST', body: { code: s.code } })
  const params = { id: s.session_id }
  await call(S.start, { method: 'POST', token: j.body.client_token, params, body: { grants: GRANTS } })
  return { ...s, client: j.body.client_token as string, params }
}

describe.skipIf(!process.env.TEST_REDIS_URL)('relay against a local Redis', () => {
  beforeAll(() => clean())
  beforeEach(() => clean('valettest:rl:*'))
  afterAll(async () => {
    await clean()
    await closeRedis()
  })

  it('runs a whole session from both sides', async () => {
    const s = await create()
    expect(s.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/)
    const params = { id: s.session_id }

    const j = await call(S.join, { method: 'POST', body: { code: ` ${s.code.toLowerCase().replace('-', ' ')} ` } })
    expect(j.status).toBe(200)
    expect(j.body).toMatchObject({ sender_name: 'Acme Inc.', verified: false, session_id: s.session_id })
    const client = j.body.client_token

    const joined = await call(S.status, { token: s.agent_token, params })
    expect(joined.body.state).toBe('joined')

    const started = await call(S.start, { method: 'POST', token: client, params, body: { grants: GRANTS } })
    expect(started.body.state).toBe('live')

    const queued = await call(A.postAction, { method: 'POST', token: s.agent_token, params, body: { ...READ, client_id: cid() } })
    expect(queued.status).toBe(201)
    expect(queued.body.status).toBe('pending')
    const aid = queued.body.action_id
    expect(queued.body.events.map((e: { type: string }) => e.type)).toEqual(['session.joined', 'session.started'])

    const inbox = await call(A.inbox, { token: client, params })
    expect(inbox.body.state).toBe('live')
    expect(inbox.body.actions.map((a: { action_id: string }) => a.action_id)).toEqual([aid])

    const output = { content: '[14:01:52] GL context lost', lines: [], nested: { empty: [] } }
    const hash = 'a'.repeat(64)
    const result = await call(A.postResult, {
      method: 'POST',
      token: client,
      params: { ...params, aid },
      body: { status: 'ok', output, hash },
    })
    expect(result.status).toBe(200)

    const done = await call(A.getAction, { token: s.agent_token, params: { ...params, aid } })
    expect(done.body).toMatchObject({ status: 'ok', output, hash, tool: 'read_file' })
    expect(done.body.events.map((e: { type: string }) => e.type)).toEqual(['action.result'])

    const again = await call(A.postResult, { method: 'POST', token: client, params: { ...params, aid }, body: { status: 'denied' } })
    expect(again.status).toBe(409)

    const empty = await call(A.inbox, { token: client, params, query: `?after=${inbox.body.last_seq}` })
    expect(empty.body.actions).toEqual([])

    const status = await call(S.status, { token: s.agent_token, params })
    expect(status.body).toMatchObject({ state: 'live', client_connected: true })
    expect(status.body.grants).toHaveLength(2)

    const ended = await call(S.end, { method: 'POST', token: s.agent_token, params })
    expect(ended.body).toEqual({ state: 'ended', ended_by: 'agent' })
    const after = await call(A.inbox, { token: client, params })
    expect(after.body.state).toBe('ended')

    const log = { entries: [{ seq: 1, type: 'session.started' }], signature: 'x' }
    expect((await call(A.putLog, { method: 'PUT', token: client, params, raw: JSON.stringify(log) })).status).toBe(200)
    expect((await call(A.getLog, { token: s.agent_token, params })).body).toEqual(log)
  })

  it('lets a join code work once', async () => {
    const s = await create()
    expect((await call(S.join, { method: 'POST', body: { code: s.code } })).status).toBe(200)
    const second = await call(S.join, { method: 'POST', body: { code: s.code } })
    expect(second.status).toBe(404)
    expect(second.body.error.hint).toMatch(/works once/)
  })

  it('keeps each side to its own endpoints and its own session', async () => {
    const a = await live()
    const b = await live()
    const asClient = await call(A.postAction, { method: 'POST', token: a.client, params: a.params, body: { ...READ, client_id: cid() } })
    expect(asClient.status).toBe(403)
    const asAgent = await call(A.inbox, { token: a.agent_token, params: a.params })
    expect(asAgent.status).toBe(403)
    const otherSession = await call(A.inbox, { token: b.client, params: a.params })
    expect(otherSession.status).toBe(401)
    const nothing = await call(S.status, { params: a.params })
    expect(nothing.status).toBe(401)
    const forged = await call(A.postResult, { method: 'POST', token: a.agent_token, params: { ...a.params, aid: 'a_AAAAAAAAAAAA' }, body: { status: 'ok' } })
    expect(forged.status).toBe(403)
  })

  it('treats a repeated client_id as the same action', async () => {
    const s = await live()
    const id = cid()
    const first = await call(A.postAction, { method: 'POST', token: s.agent_token, params: s.params, body: { ...READ, client_id: id } })
    const repeat = await call(A.postAction, { method: 'POST', token: s.agent_token, params: s.params, body: { ...READ, client_id: id } })
    expect(repeat.status).toBe(200)
    expect(repeat.body.action_id).toBe(first.body.action_id)
    const changed = await call(A.postAction, {
      method: 'POST',
      token: s.agent_token,
      params: s.params,
      body: { ...READ, reason: 'Something else.', client_id: id },
    })
    expect(changed.status).toBe(409)
  })

  it('answers a waiting agent as soon as the client does', async () => {
    const s = await live()
    const queued = await call(A.postAction, { method: 'POST', token: s.agent_token, params: s.params, body: { ...READ, client_id: cid() } })
    const aid = queued.body.action_id
    const began = Date.now()
    const waiting = call(A.getAction, { token: s.agent_token, params: { ...s.params, aid }, query: '?wait=10' })
    setTimeout(() => {
      void call(A.postResult, { method: 'POST', token: s.client, params: { ...s.params, aid }, body: { status: 'denied' } })
    }, 300)
    const answered = await waiting
    expect(answered.body.status).toBe('denied')
    expect(Date.now() - began).toBeLessThan(3000)
  })

  it('wakes a waiting client when an action arrives', async () => {
    const s = await live()
    const { body } = await call(A.inbox, { token: s.client, params: s.params })
    const began = Date.now()
    const waiting = call(A.inbox, { token: s.client, params: s.params, query: `?wait=10&after=${body.last_seq}` })
    setTimeout(() => {
      void call(A.postAction, { method: 'POST', token: s.agent_token, params: s.params, body: { ...READ, client_id: cid() } })
    }, 300)
    const woke = await waiting
    expect(woke.body.actions).toHaveLength(1)
    expect(Date.now() - began).toBeLessThan(3000)
  })

  it('ends pending actions with the session and refuses new ones', async () => {
    const s = await live()
    const queued = await call(A.postAction, { method: 'POST', token: s.agent_token, params: s.params, body: { ...READ, client_id: cid() } })
    await call(S.end, { method: 'POST', token: s.client, params: s.params })
    const action = await call(A.getAction, { token: s.agent_token, params: { ...s.params, aid: queued.body.action_id } })
    expect(action.body.status).toBe('ended')
    expect(action.body.session_state).toBe('ended')
    const late = await call(A.postAction, { method: 'POST', token: s.agent_token, params: s.params, body: { ...READ, client_id: cid() } })
    expect(late.status).toBe(410)
  })

  it('expires an unused invite and ends a session at its time limit', async () => {
    const redis = await getRedis()
    const invite = await create()
    await redis.hSet(keys.session(invite.session_id), 'created_at', Date.now() - 11 * 60_000)
    const expired = await call(S.status, { token: invite.agent_token, params: { id: invite.session_id } })
    expect(expired.body.state).toBe('expired')
    expect(await redis.exists(keys.code(invite.code.replace('-', '')))).toBe(0)

    const s = await live()
    await redis.hSet(keys.session(s.session_id), 'ends_at', Date.now() - 60_000)
    const timed = await call(S.status, { token: s.agent_token, params: s.params })
    expect(timed.body).toMatchObject({ state: 'ended', ended_by: 'time' })
  })

  it('caps extensions at three hours', async () => {
    const redis = await getRedis()
    const s = await live()
    const extended = await call(S.extend, { method: 'POST', token: s.client, params: s.params })
    expect(extended.status).toBe(200)
    await redis.hSet(keys.session(s.session_id), 'started_at', Date.now() - 2.9 * 60 * 60_000)
    const capped = await call(S.extend, { method: 'POST', token: s.client, params: s.params })
    expect(capped.status).toBe(409)
  })

  it('never leaves a session key without an expiry', async () => {
    const s = await live()
    await call(A.postAction, { method: 'POST', token: s.agent_token, params: s.params, body: { ...READ, client_id: cid() } })
    const redis = await getRedis()
    const found: string[] = []
    for await (const batch of redis.scanIterator({ MATCH: `valettest:s:${s.session_id}*`, COUNT: 100 })) found.push(...batch)
    expect(found.length).toBeGreaterThan(4)
    for (const key of found) expect(await redis.ttl(key)).toBeGreaterThan(0)
  })

  it('rejects malformed requests with hints', async () => {
    const s = await live()
    const bad = await call(A.postAction, {
      method: 'POST',
      token: s.agent_token,
      params: s.params,
      body: { tool: 'run_command', args: { command: 'rm -rf ~' }, reason: 'x', client_id: cid() },
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error.hint).toMatch(/command/)
    const escape = await call(S.createSession, { method: 'POST', body: { name: 'Acme\u001b]0;hi', agent: 'a', purpose: 'p' } })
    expect(escape.status).toBe(400)
    const wait = await call(S.status, { token: s.agent_token, params: s.params, query: '?wait=999' })
    expect(wait.status).toBe(400)
  })

  it('protects the sweep with the cron secret', async () => {
    expect((await call(sweep, {})).status).toBe(401)
    expect((await call(sweep, { token: 'wrong' })).status).toBe(401)
    const swept = await call(sweep, { token: 'test-only-cron-secret' })
    expect(swept.status).toBe(200)
    expect(swept.body).toHaveProperty('checked')
  })

  it('rate-limits join attempts', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await call(S.join, { method: 'POST', body: { code: 'ZZZ-ZZZ' } })).status)
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0)
  })
})
