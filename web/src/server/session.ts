import type { Grant, Need, SessionState } from '@valet/protocol'
import { ApiError, bearer } from './http'
import { keys, sessionKeys } from './keys'
import { LIMITS } from './limits'
import { SCRIPTS, pair, run } from './scripts'
import { isSessionId, tokenMatches } from './tokens'
import type { Redis } from './redis'

export type Role = 'agent' | 'client'
export type EndedBy = 'agent' | 'client' | 'time' | ''

export type Session = {
  id: string
  state: SessionState
  senderName: string
  purpose: string
  template: Need[]
  code: string
  createdAt: number
  joinedAt: number
  startedAt: number
  endsAt: number
  endedAt: number
  endedBy: EndedBy
  agentHash: string
  clientHash: string
  agentCursor: number
  clientSeenAt: number
  source: string
}

const num = (v: string | undefined) => Number(v ?? 0) || 0

function parse(id: string, h: Record<string, string>): Session {
  return {
    id,
    state: h.state as SessionState,
    senderName: h.sender_name ?? '',
    purpose: h.purpose ?? '',
    template: h.template ? (JSON.parse(h.template) as Need[]) : [],
    code: h.code ?? '',
    createdAt: num(h.created_at),
    joinedAt: num(h.joined_at),
    startedAt: num(h.started_at),
    endsAt: num(h.ends_at),
    endedAt: num(h.ended_at),
    endedBy: (h.ended_by ?? '') as EndedBy,
    agentHash: h.agent_hash ?? '',
    clientHash: h.client_hash ?? '',
    agentCursor: num(h.agent_cursor),
    clientSeenAt: num(h.client_seen_at),
    source: h.source ?? '',
  }
}

export const FINAL: SessionState[] = ['declined', 'expired', 'ended']

// when this session next needs attention: its deadline while open, its deletion once final
export function dueAt(s: Pick<Session, 'state' | 'createdAt' | 'joinedAt' | 'endsAt' | 'endedAt'>) {
  if (s.state === 'invited') return s.createdAt + LIMITS.inviteMs
  if (s.state === 'joined') return s.joinedAt + LIMITS.reviewMs
  if (s.state === 'live') return s.endsAt + LIMITS.endGraceMs
  return s.endedAt + LIMITS.keepAfterEndMs
}

export function expireAt(s: Parameters<typeof dueAt>[0]) {
  const at = s.state === 'live' ? dueAt(s) + LIMITS.keepAfterEndMs : dueAt(s)
  return Math.ceil(at / 1000)
}

export const gone = () =>
  new ApiError(410, 'gone', 'This session is over or does not exist.', 'This is final. Start a new session if the work goes on.')

export async function readSession(redis: Redis, id: string) {
  if (!isSessionId(id)) return undefined
  const h = await redis.hGetAll(keys.session(id))
  return h.state ? parse(id, h) : undefined
}

type Change = {
  from: SessionState[]
  fields: Record<string, string | number>
  event: Record<string, unknown>
  wake: Role[]
  endActions?: boolean
  grants?: Grant[]
  log?: string
}

export async function transition(redis: Redis, s: Session, change: Change) {
  const f = change.fields
  const timing = {
    state: (f.state ?? s.state) as SessionState,
    createdAt: s.createdAt,
    joinedAt: Number(f.joined_at ?? s.joinedAt),
    endsAt: Number(f.ends_at ?? s.endsAt),
    endedAt: Number(f.ended_at ?? s.endedAt),
  }
  const fields = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)]))
  const topics = change.wake.map((r) => (r === 'agent' ? keys.wakeAgent(s.id) : keys.wakeClient(s.id))).join(',')
  const reply = await run(redis, SCRIPTS.TRANSITION, sessionKeys(s.id), [
    expireAt(timing),
    change.from.join(','),
    JSON.stringify(fields),
    JSON.stringify({ at: Date.now(), ...change.event }),
    topics,
    change.endActions ? '1' : '0',
    change.grants ? JSON.stringify(change.grants) : '',
    change.log ?? '',
  ])
  const [seq, state] = pair(reply)
  if (!seq) {
    if (!state) throw gone()
    throw new ApiError(409, 'conflict', `The session is ${state}, so this can't be done now.`, stateHint(state as SessionState))
  }
  await redis.zAdd(keys.activeSessions(), { score: dueAt(timing), value: s.id })
  return seq
}

export function stateHint(state: SessionState) {
  if (state === 'invited') return 'The client has not joined yet. Wait on GET /api/v1/sessions/{id}?wait=50.'
  if (state === 'joined') return 'The client is reviewing the permissions. Wait on GET /api/v1/sessions/{id}?wait=50.'
  if (state === 'live') return 'The session is live.'
  return 'This session is over. Start a new one if the work goes on.'
}

// time-based endings happen here, the first time anyone touches a session after its deadline
export async function settle(redis: Redis, s: Session): Promise<Session> {
  const now = Date.now()
  if (FINAL.includes(s.state) || now <= dueAt(s)) return s
  const ending =
    s.state === 'live'
      ? { state: 'ended', ended_at: now, ended_by: 'time', event: 'session.ended' }
      : { state: 'expired', ended_at: now, ended_by: '', event: 'session.expired' }
  const { event, ...fields } = ending
  try {
    await transition(redis, s, {
      from: [s.state],
      fields,
      event: { type: event, ended_by: fields.ended_by || undefined },
      wake: ['agent', 'client'],
      endActions: true,
    })
    if (s.state === 'invited' && s.code) await redis.del(keys.code(s.code))
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error
  }
  return (await readSession(redis, s.id)) ?? s
}

export async function loadSession(redis: Redis, id: string) {
  const s = await readSession(redis, id)
  if (!s) throw gone()
  return settle(redis, s)
}

export function authorise(request: Request, s: Session, role: Role) {
  const token = bearer(request)
  const own = role === 'agent' ? s.agentHash : s.clientHash
  const other = role === 'agent' ? s.clientHash : s.agentHash
  if (tokenMatches(token, own)) return token!
  if (tokenMatches(token, other))
    throw new ApiError(403, 'forbidden', `This endpoint is for the ${role === 'agent' ? 'agent' : "client's app"}.`)
  throw unauthorized(role)
}

const unauthorized = (role?: Role) =>
  new ApiError(
    401,
    'unauthorized',
    'Invalid or missing token for this session.',
    role === 'client'
      ? 'Send the client_token from POST /api/v1/join as "Authorization: Bearer <token>".'
      : 'Send the agent_token from POST /api/v1/sessions as "Authorization: Bearer <token>".',
  )

export function authoriseEither(request: Request, s: Session): Role {
  const token = bearer(request)
  if (tokenMatches(token, s.agentHash)) return 'agent'
  if (tokenMatches(token, s.clientHash)) return 'client'
  throw unauthorized()
}

export async function readGrants(redis: Redis, id: string) {
  const raw = await redis.get(keys.grants(id))
  return raw ? (JSON.parse(raw) as Grant[]) : []
}

export async function lastSeq(redis: Redis, id: string) {
  return Number((await redis.get(keys.seq(id))) ?? 0)
}

export async function view(redis: Redis, s: Session) {
  return {
    session_id: s.id,
    state: s.state,
    sender_name: s.senderName,
    purpose: s.purpose,
    created_at: s.createdAt,
    started_at: s.startedAt || undefined,
    ends_at: s.endsAt || undefined,
    ended_at: s.endedAt || undefined,
    ended_by: s.endedBy || undefined,
    grants: await readGrants(redis, s.id),
    client_connected: s.state === 'live' && Date.now() - s.clientSeenAt < LIMITS.clientGoneMs,
    last_seq: await lastSeq(redis, s.id),
  }
}

export async function advance(redis: Redis, id: string, field: 'agent_cursor' | 'client_seen_at', value: number) {
  await run(redis, SCRIPTS.ADVANCE, [keys.session(id)], [field, value])
}
