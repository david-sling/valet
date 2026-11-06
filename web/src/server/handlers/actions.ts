import { createHash } from 'node:crypto'
import { ActionBody, ResultBody, StartBody } from '@valet/protocol'
import { ApiError, bearer, json, notFound, readBody, readJson, readWait } from '../http'
import { keys, sessionKeys } from '../keys'
import { LIMITS, RATES } from '../limits'
import { limit, pollSlot } from '../rate-limit'
import { getRedis } from '../redis'
import { SCRIPTS, pair, run } from '../scripts'
import { FINAL, advance, authorise, authoriseEither, expireAt, gone, lastSeq, loadSession, stateHint, transition } from '../session'
import { isActionId, newActionId } from '../tokens'
import { hold } from '../wake'
import type { Params } from '../http'
import type { Redis } from '../redis'
import type { Session } from '../session'
import type { SessionState } from '@valet/protocol'

// args_json is a string so cjson never re-encodes it (it can't tell {} from [], so args: {} came back as []);
// args is what records written before that carry
type Stored = {
  id: string
  seq: number
  tool: string
  args_json?: string
  args?: unknown
  reason: string
  status: string
  created_at: number
  answered_at?: number
}

async function readAction(redis: Redis, id: string, aid: string) {
  const [raw, result] = await redis.hmGet(keys.actions(id), [aid, `${aid}:result`])
  if (!raw) return undefined
  const a = JSON.parse(raw) as Stored
  return {
    action_id: a.id,
    seq: a.seq,
    tool: a.tool,
    args: a.args_json === undefined ? a.args : (JSON.parse(a.args_json) as unknown),
    reason: a.reason,
    status: a.status,
    created_at: a.created_at,
    answered_at: a.answered_at,
    ...(result ? (JSON.parse(result) as Record<string, unknown>) : {}),
  }
}

async function readEvents(redis: Redis, id: string, after: number, count = 200) {
  const raw = await redis.zRangeByScore(keys.events(id), `(${after}`, '+inf', { LIMIT: { offset: 0, count } })
  return raw.map((e) => JSON.parse(e) as { seq: number } & Record<string, unknown>)
}

async function unseenEvents(redis: Redis, s: Session) {
  const events = await readEvents(redis, s.id, s.agentCursor)
  if (events.length) await advance(redis, s.id, 'agent_cursor', events[events.length - 1].seq)
  return events
}

async function waiting<T>(redis: Redis, request: Request, wait: number, topic: string, check: () => Promise<T | undefined>) {
  const token = bearer(request)!
  if (wait === 0) {
    await limit(redis, 'poll', token, RATES.poll)
    return check()
  }
  const release = await pollSlot(redis, token)
  try {
    return await hold(redis, topic, wait * 1000, request.signal, LIMITS.wakeTickMs, check)
  } finally {
    await release()
  }
}

function refused(state: string) {
  if (FINAL.includes(state as SessionState) || state === '') return gone()
  return new ApiError(409, 'conflict', `The session is ${state}, so this can't be done now.`, stateHint(state as SessionState))
}

async function answer(request: Request, redis: Redis, s: Session, aid: string, status = 200) {
  const { wait } = readWait(request)
  await waiting(redis, request, wait, keys.wakeAgent(s.id), async () => {
    const a = await readAction(redis, s.id, aid)
    return a && a.status !== 'pending' ? a : undefined
  })
  const action = await readAction(redis, s.id, aid)
  if (!action) throw notFound('There is no such action in this session.')
  const fresh = await loadSession(redis, s.id).catch(() => s)
  return json({ ...action, session_state: fresh.state, events: await unseenEvents(redis, fresh) }, status)
}

export async function postAction(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'agent')
  await limit(redis, 'action', id, RATES.action)
  readWait(request)
  const { reason, client_id, ...req } = await readJson(request, ActionBody)
  const args = 'args' in req ? (req.args ?? {}) : {}
  const aid = newActionId()
  const now = Date.now()
  const record = { id: aid, tool: req.tool, args_json: JSON.stringify(args), reason, status: 'pending', created_at: now }
  const digest = createHash('sha256').update(JSON.stringify({ tool: req.tool, args, reason })).digest('hex')
  const reply = await run(redis, SCRIPTS.ENQUEUE, [...sessionKeys(id), keys.idem(id, client_id)], [
    expireAt(s),
    now,
    JSON.stringify(record),
    aid,
    digest,
    LIMITS.idemSeconds,
    LIMITS.maxPending,
    LIMITS.endGraceMs,
    keys.wakeClient(id),
  ])
  const [code, value] = pair(reply)
  if (code === 0) {
    if (value === 'conflict')
      throw new ApiError(409, 'conflict', 'That client_id was already used for a different action.', 'Use a new client_id for each new action.')
    if (value === 'busy')
      throw new ApiError(429, 'rate_limited', `${LIMITS.maxPending} actions are already waiting for the client.`, 'Wait for some to be answered first.', {
        'Retry-After': '10',
      })
    throw refused(value === 'ended' ? 'ended' : value)
  }
  return answer(request, redis, s, code === 2 ? value : aid, code === 1 ? 201 : 200)
}

export async function getAction(request: Request, { id, aid }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'agent')
  if (!isActionId(aid)) throw notFound('There is no such action in this session.')
  return answer(request, redis, s, aid)
}

export async function events(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'agent')
  const { wait, after = 0 } = readWait(request)
  await waiting(redis, request, wait, keys.wakeAgent(id), async () => {
    await loadSession(redis, id).catch(() => undefined)
    return (await lastSeq(redis, id)) > after || undefined
  })
  const list = await readEvents(redis, id, after)
  if (list.length) await advance(redis, id, 'agent_cursor', list[list.length - 1].seq)
  const fresh = await loadSession(redis, id).catch(() => s)
  return json({ state: fresh.state, events: list, last_seq: await lastSeq(redis, id) })
}

export async function inbox(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'client')
  const { wait, after = 0 } = readWait(request)
  await advance(redis, id, 'client_seen_at', Date.now())
  await waiting(redis, request, wait, keys.wakeClient(id), async () => {
    const now = await loadSession(redis, id).catch(() => undefined)
    if (!now || now.state !== 'live') return true
    return (await redis.zCount(keys.inbox(id), `(${after}`, '+inf')) > 0 || undefined
  })
  const fresh = await loadSession(redis, id).catch(() => undefined)
  if (!fresh) throw gone()
  const ids = fresh.state === 'live' ? await redis.zRangeByScore(keys.inbox(id), `(${after}`, '+inf') : []
  const actions = (await Promise.all(ids.map((aid) => readAction(redis, id, aid)))).filter(Boolean)
  return json({ state: fresh.state, ends_at: fresh.endsAt || undefined, actions, last_seq: await lastSeq(redis, id) })
}

export async function postResult(request: Request, { id, aid }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'client')
  if (!isActionId(aid)) throw notFound('There is no such action in this session.')
  const { status, ...result } = await readJson(request, ResultBody, LIMITS.resultBytes)
  const reply = await run(redis, SCRIPTS.RESULT, sessionKeys(id), [
    expireAt(s),
    aid,
    JSON.stringify(result),
    Date.now(),
    keys.wakeAgent(id),
    status,
  ])
  const [seq, value] = pair(reply)
  if (!seq) {
    if (value === 'missing') throw notFound('There is no such action in this session.')
    if (value === 'final') throw new ApiError(409, 'conflict', 'This action already has an answer.')
    throw refused(value)
  }
  return json({ ok: true, seq })
}

export async function putGrants(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'client')
  const { grants } = await readJson(request, StartBody)
  await transition(redis, s, {
    from: ['live'],
    fields: {},
    event: { type: 'grants.changed', grants: grants.filter((g) => g.on).length },
    wake: ['agent'],
    grants,
  })
  return json({ ok: true })
}

export async function putLog(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'client')
  const text = await readBody(request, LIMITS.logBytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new ApiError(400, 'invalid_request', 'The log must be a JSON object.')
  await transition(redis, s, {
    from: ['ended'],
    fields: { log_at: Date.now() },
    event: { type: 'log.ready' },
    wake: ['agent'],
    log: text,
  })
  return json({ ok: true })
}

export async function getLog(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authoriseEither(request, s)
  const log = await redis.get(keys.log(id))
  if (!log)
    throw notFound("The client hasn't sent the sealed log yet.", 'It is sent after the session ends; wait for a log.ready event.')
  return new Response(log, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
