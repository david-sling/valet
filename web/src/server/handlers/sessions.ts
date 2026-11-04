import { CreateSessionBody, JoinBody, StartBody, normaliseCode } from '@valet/protocol'
import { getConfig } from '../config'
import { ApiError, json, notFound, readJson, readWait } from '../http'
import { keys } from '../keys'
import { LIMITS, RATES } from '../limits'
import { clientIp, limit, pollSlot } from '../rate-limit'
import { getRedis } from '../redis'
import {
  FINAL,
  authorise,
  authoriseEither,
  dueAt,
  expireAt,
  lastSeq,
  loadSession,
  readSession,
  transition,
  view,
} from '../session'
import { formatCode, hashToken, newCode, newSessionId, newToken } from '../tokens'
import { hold } from '../wake'
import type { Params } from '../http'

export async function createSession(request: Request) {
  const redis = await getRedis()
  await limit(redis, 'create', clientIp(request), RATES.create)
  const body = await readJson(request, CreateSessionBody)
  const id = newSessionId()
  const token = newToken()
  const now = Date.now()

  let code = ''
  for (let i = 0; i < 5 && !code; i++) {
    const candidate = newCode()
    const set = await redis.set(keys.code(candidate), id, {
      condition: 'NX',
      expiration: { type: 'EX', value: LIMITS.inviteMs / 1000 },
    })
    if (set) code = candidate
  }
  if (!code) throw new ApiError(503, 'server_error', 'Could not allocate a join code.', 'Retry in a few seconds.')

  const timing = { state: 'invited' as const, createdAt: now, joinedAt: 0, endsAt: 0, endedAt: 0 }
  const at = expireAt(timing)
  await redis
    .multi()
    .hSet(keys.session(id), {
      state: 'invited',
      sender_name: body.name,
      agent_name: body.agent,
      purpose: body.purpose,
      template: JSON.stringify(body.template ?? []),
      code,
      created_at: now,
      agent_hash: hashToken(token),
    })
    .set(keys.seq(id), '0')
    .expireAt(keys.session(id), at)
    .expireAt(keys.seq(id), at)
    .zAdd(keys.activeSessions(), { score: dueAt(timing), value: id })
    .exec()

  const shown = formatCode(code)
  return json(
    {
      session_id: id,
      agent_token: token,
      code: shown,
      join_url: `${getConfig().host}/j/${shown}`,
      state: 'invited',
      expires_at: now + LIMITS.inviteMs,
    },
    201,
  )
}

export async function join(request: Request) {
  const redis = await getRedis()
  await limit(redis, 'join', clientIp(request), RATES.join)
  await limit(redis, 'join', 'everyone', RATES.joinGlobal)
  const { code } = await readJson(request, JoinBody)
  const clean = normaliseCode(code)
  const id = clean.length === 6 ? await redis.getDel(keys.code(clean)) : null
  if (!id)
    throw notFound(
      "That code doesn't match an open session.",
      'Check the code with whoever sent it. A code works once and expires 10 minutes after it was made.',
    )
  const s = await loadSession(redis, id)
  const token = newToken()
  const now = Date.now()
  await transition(redis, s, {
    from: ['invited'],
    fields: { state: 'joined', joined_at: now, client_hash: hashToken(token) },
    event: { type: 'session.joined' },
    wake: ['agent'],
  })
  return json({
    session_id: s.id,
    client_token: token,
    sender_name: s.senderName,
    agent_name: s.agentName,
    purpose: s.purpose,
    verified: false,
    template: s.template,
    created_at: s.createdAt,
    review_until: now + LIMITS.reviewMs,
  })
}

export async function decline(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'client')
  await transition(redis, s, {
    from: ['joined'],
    fields: { state: 'declined', ended_at: Date.now(), ended_by: 'client' },
    event: { type: 'session.declined' },
    wake: ['agent'],
  })
  return json({ state: 'declined' })
}

export async function start(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'client')
  const { grants } = await readJson(request, StartBody)
  const now = Date.now()
  const endsAt = now + LIMITS.sessionMs
  await transition(redis, s, {
    from: ['joined'],
    fields: { state: 'live', started_at: now, ends_at: endsAt, client_seen_at: now },
    event: { type: 'session.started', grants: grants.filter((g) => g.on).length, ends_at: endsAt },
    wake: ['agent'],
    grants,
  })
  return json({ state: 'live', ends_at: endsAt })
}

export async function extend(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  authorise(request, s, 'client')
  const endsAt = s.endsAt + LIMITS.extendMs
  if (s.state === 'live' && endsAt > s.startedAt + LIMITS.maxSessionMs)
    throw new ApiError(409, 'conflict', 'A session can last at most 3 hours.', 'End this session and start a new one.')
  await transition(redis, s, {
    from: ['live'],
    fields: { ends_at: endsAt },
    event: { type: 'session.extended', ends_at: endsAt },
    wake: ['agent'],
  })
  return json({ state: 'live', ends_at: endsAt })
}

export async function end(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  const role = authoriseEither(request, s)
  if (FINAL.includes(s.state)) return json({ state: s.state, ended_by: s.endedBy || undefined })
  await transition(redis, s, {
    from: ['invited', 'joined', 'live'],
    fields: { state: 'ended', ended_at: Date.now(), ended_by: role },
    event: { type: 'session.ended', ended_by: role },
    wake: ['agent', 'client'],
    endActions: true,
  })
  if (s.state === 'invited' && s.code) await redis.del(keys.code(s.code))
  return json({ state: 'ended', ended_by: role })
}

export async function status(request: Request, { id }: Params) {
  const redis = await getRedis()
  const s = await loadSession(redis, id)
  const role = authoriseEither(request, s)
  const { wait, after } = readWait(request)
  const token = request.headers.get('authorization')!
  if (wait > 0) {
    const release = await pollSlot(redis, token)
    try {
      const since = after ?? (await lastSeq(redis, id))
      const topic = role === 'agent' ? keys.wakeAgent(id) : keys.wakeClient(id)
      await hold(redis, topic, wait * 1000, request.signal, LIMITS.wakeTickMs, async () => {
        const now = await readSession(redis, id)
        if (!now) return true
        await loadSession(redis, id)
        return (await lastSeq(redis, id)) > since || undefined
      })
    } finally {
      await release()
    }
  } else {
    await limit(redis, 'poll', token, RATES.poll)
  }
  return json(await view(redis, await loadSession(redis, id)))
}
