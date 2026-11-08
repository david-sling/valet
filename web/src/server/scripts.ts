import type { Redis } from './redis'

// KEYS[1..7] are always a session's keys in sessionKeys() order: session, seq, events, inbox, actions, grants, log
const PRELUDE = `
local function stamp(at) for i = 1, 7 do redis.call('EXPIREAT', KEYS[i], at) end end
local function event(e)
  local seq = redis.call('INCR', KEYS[2])
  e.seq = seq
  redis.call('ZADD', KEYS[3], seq, cjson.encode(e))
  return seq
end
local function wake(topics, seq)
  for topic in string.gmatch(topics, '[^,]+') do redis.call('PUBLISH', topic, seq) end
end
`

// ARGV: expireAt, allowed states (csv), fields (json), event (json), wake topics (csv), end actions ('1': also drops every
// result's output, so it never outlives the session), grants json or '', sealed log or ''
const TRANSITION = `${PRELUDE}
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return {0, ''} end
local allowed = false
for s in string.gmatch(ARGV[2], '[^,]+') do if s == state then allowed = true end end
if not allowed then return {0, state} end
local fields = cjson.decode(ARGV[3])
for k, v in pairs(fields) do redis.call('HSET', KEYS[1], k, tostring(v)) end
if ARGV[7] ~= '' then redis.call('SET', KEYS[6], ARGV[7]) end
if ARGV[8] ~= '' then redis.call('SET', KEYS[7], ARGV[8]) end
if ARGV[6] == '1' then
  local all = redis.call('HGETALL', KEYS[5])
  for i = 1, #all, 2 do
    if string.find(all[i], ':result$') then
      local r = cjson.decode(all[i + 1])
      if r.output ~= nil then
        r.output = nil
        r.output_deleted = true
        redis.call('HSET', KEYS[5], all[i], cjson.encode(r))
      end
    end
    local a = not string.find(all[i], ':') and cjson.decode(all[i + 1])
    if a and a.status == 'pending' then
      a.status = 'ended'
      redis.call('HSET', KEYS[5], all[i], cjson.encode(a))
    end
  end
  redis.call('DEL', KEYS[4])
end
local seq = event(cjson.decode(ARGV[4]))
stamp(ARGV[1])
wake(ARGV[5], seq)
return {seq, fields.state or state}
`

// KEYS[8] idempotency key. ARGV: expireAt, now, action json, action id, digest, idem seconds, max pending, grace ms, client topic
const ENQUEUE = `${PRELUDE}
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'live' then return {0, state or ''} end
local endsAt = tonumber(redis.call('HGET', KEYS[1], 'ends_at'))
if tonumber(ARGV[2]) > endsAt + tonumber(ARGV[8]) then return {0, 'ended'} end
local seen = redis.call('GET', KEYS[8])
if seen then
  local id, digest = string.match(seen, '^([^|]+)|(.+)$')
  if digest ~= ARGV[5] then return {0, 'conflict'} end
  return {2, id}
end
if redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[7]) then return {0, 'busy'} end
local seq = redis.call('INCR', KEYS[2])
local a = cjson.decode(ARGV[3])
a.seq = seq
redis.call('HSET', KEYS[5], ARGV[4], cjson.encode(a))
redis.call('ZADD', KEYS[4], seq, ARGV[4])
redis.call('SET', KEYS[8], ARGV[4] .. '|' .. ARGV[5], 'EX', tonumber(ARGV[6]))
stamp(ARGV[1])
redis.call('PUBLISH', ARGV[9], seq)
return {1, ARGV[4]}
`

// the result is stored verbatim beside the action, so cjson never re-encodes client output (it turns [] into {})
// ARGV: expireAt, action id, result json, now, agent topic, status
const RESULT = `${PRELUDE}
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'live' then return {0, state or ''} end
local raw = redis.call('HGET', KEYS[5], ARGV[2])
if not raw then return {0, 'missing'} end
local a = cjson.decode(raw)
if a.status ~= 'pending' then return {0, 'final'} end
a.status = ARGV[6]
a.answered_at = tonumber(ARGV[4])
redis.call('HSET', KEYS[5], ARGV[2], cjson.encode(a), ARGV[2] .. ':result', ARGV[3])
redis.call('ZREM', KEYS[4], ARGV[2])
local seq = event({type = 'action.result', action_id = ARGV[2], status = ARGV[6], at = tonumber(ARGV[4])})
stamp(ARGV[1])
wake(ARGV[5], seq)
return {seq, 'live'}
`

// KEYS[1] slot set. ARGV: now, member, max, stale ms
const ACQUIRE_SLOT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[4]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], 120)
return 1
`

// moves a numeric field forward without ever recreating an expired session. ARGV: field, value
const ADVANCE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if tonumber(ARGV[2]) > tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0') then redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]) end
return 1
`

export const SCRIPTS = { TRANSITION, ENQUEUE, RESULT, ACQUIRE_SLOT, ADVANCE }

export async function run(redis: Redis, script: string, keys: string[], args: (string | number)[]) {
  return (await redis.eval(script, { keys, arguments: args.map(String) })) as unknown
}

export function pair(reply: unknown): [number, string] {
  const [a, b] = reply as [number | string, string]
  return [Number(a), String(b ?? '')]
}
